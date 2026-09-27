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
