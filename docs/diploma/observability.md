# API and database observability

## What and why

Prometheus metrics show request volume, failures, latency, process health, and
database health over time. Logs explain individual events; metrics summarize
rates and distributions without recording request payloads. Traces connect a
single request across services and are a separate future capability.

HTTP metric names follow Prometheus conventions: `http_requests_total` is a
counter and `http_request_duration_seconds` is a histogram. Both use method,
Nest route template, and status labels. Raw URLs and IDs are never labels. Node
process metrics are collected by `prom-client`; `active_workouts` is a
15-second cached database gauge.

## Start and open

Set unique `METRICS_TOKEN` (24+ characters) and `GRAFANA_ADMIN_PASSWORD` in
`.env`, then run:

```sh
docker compose --profile observability up --build
```

Open Grafana at `http://localhost:3001`, sign in as `admin` with the configured
password, and choose the provisioned API Overview or PostgreSQL dashboard.
Prometheus is available at `http://localhost:9090`. Both host ports bind only
to `127.0.0.1`; use `GRAFANA_PORT` and `PROMETHEUS_PORT` to change them.
`GET /metrics` requires `Authorization: Bearer $METRICS_TOKEN`, is skipped by
the global throttler, and remains protected if the API is reachable through a
tunnel. Prometheus scrapes the primary PostgreSQL exporter; add a new scrape
job when a `postgres-replica` service exists. The replication-lag panel is
provisioned and remains empty until a replica exporter supplies that metric.

## Demo

In another terminal, generate a small amount of local API traffic:

```sh
for i in $(seq 1 40); do curl -s http://localhost:3000/ >/dev/null; done
```

Refresh the API Overview dashboard to see request rate and process metrics.
Authenticated workout routes can be exercised with a local access token to
populate route-level latency and request panels.

## Screenshot placeholders

- `screenshots/api-overview.png` — API Overview with traffic and latency.
- `screenshots/postgresql.png` — PostgreSQL dashboard.
- `screenshots/prometheus-targets.png` — API and primary exporter targets UP.
- `screenshots/logs.png` — Logs dashboard filtered to a single requestId.

## Logs (Loki)

### Metrics vs. logs vs. traces

- **Metrics** (Prometheus, above) are pre-aggregated numbers over time —
  counters and histograms — cheap to store for months and ideal for rates,
  ratios, and alerting thresholds, but they cannot tell you what a *specific*
  request did.
- **Logs** (this section) are discrete, timestamped events — one line per
  request, error, or lifecycle event — that explain what happened for one
  request or one user. They are far more expensive to store than metrics
  (a line per event vs. a handful of aggregated buckets), so they get a much
  shorter retention (7 days here) and a separate store (Loki) rather than
  living in Prometheus.
- **Traces** (not implemented) would follow one request's causal chain
  *across* services with parent/child spans and timing per hop. With a
  single API service and no downstream calls of its own, a request ID
  threaded through logs already gives the same correlation a trace would;
  traces become worth adding once there is more than one hop to see.

### Pipeline

```
nestjs-pino (api container)
  -> JSON line on stdout (requestId, level, req, res, msg, time, ...)
  -> Docker's container log driver (json-file)
  -> Grafana Alloy (discovery.docker + loki.source.docker, via the
     read-only Docker socket mount)
       -> keeps only this Compose project's containers
       -> stage.json parses the api's pino line
       -> stage.template maps numeric pino levels to names
       -> stage.labels promotes only `level` to a label
       -> stage.structured_metadata attaches requestId/req.method/req.url/
          res.statusCode without indexing them
  -> Loki (grafana/loki, filesystem storage, 7d retention via the compactor)
  -> Grafana (Loki datasource with a requestId derived field; Logs dashboard
     provisioned next to API Overview/PostgreSQL)
```

Every container in the stack (`postgres`, `minio`, `grafana`, `prometheus`,
`loki`, `alloy` itself, ...) is discovered and shipped the same way; only the
`api` container's lines are additionally JSON-parsed, since it is the only
one that currently logs structured JSON (see the `stage.match` selector in
`docker/observability/alloy/config.alloy` — extend it when another Node
service is added).

### Why labels must be low-cardinality

Every distinct combination of Loki label values gets its own log **stream**
with its own chunk/index bookkeeping — the same reason Prometheus labels
must not carry raw IDs (see "What and why" above). `service` and `level` are
labels because they each take a handful of fixed values (one per Compose
service; `trace`..`fatal`). `requestId` is one-per-request — effectively
unbounded cardinality — so making it a label would create a new stream per
request and blow up Loki's index for no query benefit. Instead it (and
`req.method`/`req.url`/`res.statusCode`, also per-request) is attached as
**structured metadata**: stored alongside each line, filterable with
`| requestId="..."`, but never indexed as a stream label. This is exactly
the boundary Loki's own docs draw between "labels" and "structured
metadata", and it is enforced here in the Alloy pipeline (`stage.labels` vs.
`stage.structured_metadata`), not in application code.

### Security note: the Docker socket

Alloy is mounted `/var/run/docker.sock:/var/run/docker.sock:ro` so it can
discover containers and tail their logs. Read-only does not make this safe
to hand out casually: access to the Docker socket is equivalent to root on
the host (list/inspect/exec into any container, read any other container's
env/secrets, or ask the daemon to start a new privileged one). Nothing
outside the `alloy` container can reach that socket; treat the `alloy`
container itself as a root-equivalent process on the host, same as you would
the Docker CLI, and do not extend its responsibilities beyond log
collection.

### Demo: correlate a request across the whole stack by requestId

```sh
# 1. A normal request (200)
curl -si http://localhost:3000/ | head -1

# 2. Unauthorized: an authenticated route without a token (401)
curl -si http://localhost:3000/workouts/active | head -1

# 3. Payload too large: body over the configured limit (413)
curl -si -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"padding\":\"$(head -c 11000000 </dev/zero | tr '\0' 'a')\"}" | head -1

# 4. Not found: an unknown route (404)
curl -si http://localhost:3000/no-such-route | head -1
```

Each response includes `X-Request-Id: <id>`; copy any one of them (e.g. from
the 401 response) with:

```sh
curl -si http://localhost:3000/workouts/active | grep -i x-request-id
```

Then, in Grafana (`http://localhost:3001`):

1. Open the **Logs** dashboard (Observability folder) and paste the id into
   the **Request ID contains** variable — every line from every service for
   that one request appears, ordered by time.
2. Or open **Explore**, pick the **Loki** datasource, and run
   `{service=~".+"} | requestId="<id>"` directly.
3. Or, from any logs panel showing the raw line, click the highlighted
   `requestId` value: the derived field jumps straight to the same query
   (`docker/observability/grafana/provisioning/datasources/loki.yml`).
4. From **API Overview**, the "5xx error rate" panel links to the Logs
   dashboard pre-filtered to `service=api, level=error` for the same time
   range — the cleanest path from "errors are spiking" to "here are the
   lines," since a hand-built Explore deep link would otherwise have to
   encode Explore's pane state by hand and is fragile across Grafana
   versions.

### Alerting

`docker/observability/grafana/provisioning/alerting/rules.yml` provisions
one Grafana-managed alert, "API error logs > 20 per 5m", querying the Loki
datasource directly (`sum(count_over_time({service="api"} | level="error"
[5m]))` via a classic-conditions threshold). This was chosen over a Loki
ruler rule because a ruler rule needs its own rule storage and, in the
default alerting path, an Alertmanager to route to — Grafana's own alerting
engine evaluates rules against any datasource (Prometheus or Loki alike)
without either, which is exactly how this stack already runs Prometheus's
`alerts.yml` rules (evaluated, visible, but not wired to a notification
channel). No contact point/notification policy is provisioned here for the
same reason: the rule firing and changing state in Grafana's Alerting UI is
the observable outcome for this dev/diploma stack, not a page to anyone.

### Limitations

- Alloy does not persist its read position (`--storage.path` is set but
  nothing is volume-mounted): a restart may re-tail recent container log
  history rather than resuming exactly where it left off. Acceptable for a
  dev stack; add a named volume for `/var/lib/alloy/data` if that matters.
- The requestId derived field and the demo script depend on the api's pino
  line actually containing `"requestId":"..."` in the raw text (it does,
  via nestjs-pino's `mixin`); a future change to the log serializer that
  drops that field would silently break both without failing any test.
- Only the api's lines get `level`/`requestId`/etc.; postgres/minio/etc.
  logs are collected (visible on the Logs dashboard, filterable by
  `service`) but not structured beyond that.
