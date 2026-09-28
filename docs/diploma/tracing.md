# Distributed tracing

A trace follows one operation across processes. Its spans describe work such as
HTTP handling, SQL, and Kafka publication. W3C `traceparent` carries the trace
and parent span IDs; `tracestate` carries optional vendor state. Metrics show
something is wrong, traces show where, and logs explain why.

`initTracing`/`shutdownTracing` (and the scrubbing/producer-span helpers) are
Nest independent and live in `packages/tracing/tracing.ts` — the same
convention as `packages/event-contracts`: plain TS, imported by relative path,
pulled into the build/production image because `src/tracing/register.ts` and
`src/relay/register.ts` import it (`nest build`'s TypeScript program follows
that import outside `src/`, so `dist/packages/tracing/tracing.js` exists next
to `dist/src/...` — same as `dist/packages/event-contracts`). This is what
lets a future standalone analytics consumer reuse `initTracing` without
depending on Nest at all.

Each entry point loads a thin, Nest-aware register file first, before Nest,
pg, or KafkaJS: `src/tracing/register.ts` for the API (`main.ts`, service
name defaults to `hit-api`) and `src/relay/register.ts` for the standalone
outbox relay (`relay/main.ts`, defaults to `hit-relay`). Both honor
`OTEL_SERVICE_NAME` when set; only the default differs, so two Nest processes
in the same trace are never confused for one service in Jaeger/Grafana.

An empty `OTEL_EXPORTER_OTLP_ENDPOINT` disables the SDK.
The SDK uses `OTEL_TRACES_SAMPLER=parentbased_always_on` by default; production
can use `parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1`.
HTTP URL query strings and credential headers are excluded from span attributes.
SQL parameters and HTTP bodies are never enabled. `X-Trace-Id` is exposed by
CORS; pino logs contain the current `traceId` and `spanId` beside `requestId`.

### Shutdown ordering

`initTracing` does not register its own SIGTERM/SIGINT handlers. Shutting the
OTel SDK down as soon as a signal arrives would close the trace exporter
while Nest is still running other providers' `onModuleDestroy`/
`beforeApplicationShutdown` hooks — e.g. `RelayService.onModuleDestroy`
flushing a final Kafka publish, which opens a producer span — and those
spans would be lost. Instead, `src/tracing/tracing-shutdown.hook.ts` exposes
an `onApplicationShutdown` hook (Nest's last shutdown phase, after every
other provider has torn down) that calls `shutdownTracing()`;
`TracingShutdownModule` wires it into both `AppModule` and `RelayModule`, so
it runs for both the API and the standalone relay process. A process with no
Nest application/context at all (e.g. a future standalone analytics
consumer) gets none of that ordering for free and must opt into
`installShutdownSignalHandlers()` (or call `shutdownTracing()` from its own
signal handler) to flush spans on exit — see the doc comments in
`packages/tracing/tracing.ts`.

The outbox commits a nullable W3C context beside each event. The relay runs
later in another process, so automatic instrumentation cannot infer the parent.
It extracts that context and starts a producer span as a child of the enqueue
span, then passes its context in Kafka headers. This parent relationship treats
publish as deferred work caused by the original request. The KafkaJS auto
instrumentation may replace the same header keys with its nested send span;
there is still one trace and one value per header. A consumer extracts those
headers and starts a CONSUMER span. See `packages/event-contracts/TRACING.md`.

### The analytics consumer

`services/analytics/` (docs/diploma/analytics-cqrs.md) is a separate Nest
process; it gets tracing the same way the API and relay do: `src/main.ts`'s
very first import is `services/analytics/src/tracing/register.ts`, which
calls the same `initTracing` from `packages/tracing/tracing.ts` (defaulting
to service name `hit-analytics`), and `TracingShutdownModule` (a copy of
`src/tracing/tracing-shutdown.module.ts`, wired into `AppModule`) flushes
spans in `onApplicationShutdown`, after `KafkaConsumerService` has left the
consumer group and `DeadLetterProducer` has disconnected. Its Dockerfile
copies `packages/tracing` into the build stage alongside `packages/event-
contracts` (`services/analytics/Dockerfile`); because `packages/tracing` is a
sibling of `services/analytics`, not a descendant, a symlink
(`/app/node_modules` -> the service's own `node_modules`) lets `packages/
tracing`'s `@opentelemetry/*` imports resolve during that build - the
compiled `dist/packages/tracing` ends up nested under `services/analytics/
dist`, so no such symlink is needed at runtime. The one-shot
`rebuild-projections` CLI (`services/analytics/src/cli/rebuild-projections.ts`)
deliberately has no tracing register: it is not a Nest app and not a message
consumer, just an admin command (reset offsets, truncate tables, exit) with
no request/consumer span to join.

`@opentelemetry/instrumentation-kafkajs` already wraps `consumer.run`'s
`eachMessage` (verified by reading its source, version 0.31.0): it extracts
the `traceparent` header with `propagation.extract` and starts a CONSUMER
span (`process <topic>`, `messaging.system=kafka`, destination name,
partition, offset, message key) *around* the analytics service's own
`eachMessage` callback - so `MessageHandler.handle` and every `pg` query the
projection issues already run, and nest, inside that span with no code
changes to either. `packages/tracing/tracing.ts` adds one `consumerHook` to
that instrumentation (`kafkaConsumerHook`, unit-tested in
`packages/tracing/tracing.spec.ts`) that tags the span with `event.id`/
`event.type` read from the relay's `event-id`/`event-type` headers - never
the message payload. A DLQ produce (`DeadLetterProducer.publish`) runs inside
that same active context, so the same instrumentation's producer-side
`propagation.inject` stamps the dead letter's `traceparent` with a span
parented under the original message's CONSUMER span, the same way the relay's
own retried publishes are.

Jaeger all-in-one 1.76 is used because v2 requires a separate collector/storage
configuration for this local demo. Its in-memory store is capped at 10,000
traces and 512 MB; it loses traces on restart. The UI binds to loopback only.
Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` in the Compose env file
when enabling the observability profile. Tracing stays off by default.

## Metrics -> logs -> traces

Grafana provisions all three signal datasources
(`docker/observability/grafana/provisioning/datasources/`:
`prometheus.yml`, `loki.yml`, `jaeger.yml` — Jaeger has its own file now,
matching `loki.yml`, rather than sharing `prometheus.yml`) and links them so
one incident can be followed end to end without hand-building a query:

1. **Metrics -> logs**: the API Overview dashboard's "5xx error rate" panel
   links to the Logs dashboard pre-filtered to `service=api, level=error` for
   the same time range (see docs/diploma/observability.md).
2. **Logs -> traces**: `loki.yml`'s second derived field matches
   `"traceId":"([a-f0-9]{32})"` in a log line and opens that trace ID in the
   `jaeger` datasource (`datasourceUid: jaeger`, `url: '${__value.raw}'`) —
   the same mechanism as the existing `requestId` derived field, except the
   target datasource is a trace store instead of Loki itself, so Grafana
   opens the Jaeger trace view rather than another Explore/Loki query.
3. **Traces -> logs**: `jaeger.yml`'s `jsonData.tracesToLogsV2` does the
   reverse jump from an open trace back to its log lines: `customQuery: true`
   with `query: '{service=~".+"} | traceId="${__trace.traceId}"'`, because
   `traceId` is Loki structured metadata, not a label (the tag-mapping form
   of `tracesToLogsV2` only builds label matchers, which cannot express a
   structured-metadata filter). `${__trace.traceId}` is Grafana's built-in
   variable for the currently open trace's ID.

## Demo

1. Start `docker compose --profile observability --profile events up --build`.
2. Log in and finish a workout through the API. Copy `X-Trace-Id` from the
   finish response.
3. Open `http://127.0.0.1:16686`, search service `hit-api`, and inspect the
   trace ID. The HTTP server and pg spans precede the later `hit-relay`
   producer span, which itself precedes an `hit-analytics` CONSUMER span with
   its own nested pg spans - one trace end to end: HTTP -> pg -> relay
   producer -> analytics consumer -> analytics pg writes. Grafana also
   provisions Jaeger as datasource `jaeger`.
4. Search the same trace ID in JSON pino logs: in Grafana, open **Explore**,
   pick the **Loki** datasource, and run `{service=~".+"} | traceId="<id>"`,
   or click the highlighted `traceId` value on any logs panel showing the raw
   line — the derived field jumps straight to the trace in Jaeger. From an
   open trace in Jaeger's own UI embedded in Grafana, "Logs for this span"
   jumps back to the matching Loki lines (`tracesToLogsV2` above).

Recorded run (isolated Compose project, ports/subnet overridden so it never
touched a dev stack already running on the defaults): finishing workout 76
returned `X-Trace-Id: fd426b5c36caad41963998bb355a572b`. Jaeger's HTTP API
(`GET /api/traces/<id>`) returned one trace of 39 spans across all three
services:

- `hit-api`: `POST /workouts/:id/finish` -> `finishWorkout` -> `pg.query:BEGIN/
  SELECT/UPDATE/INSERT/COMMIT nestdb` (the outbox insert and the workout
  update share the request's transaction).
- `hit-relay`: `publish hit.workout.v1` (the outbox's own producer span,
  child of `finishWorkout`) -> `send hit.workout.v1` (the KafkaJS auto
  instrumentation's nested producer span).
- `hit-analytics`: `process hit.workout.v1`, a CONSUMER span child of `send
  hit.workout.v1`, tagged `messaging.system=kafka`,
  `messaging.destination.name=hit.workout.v1`,
  `messaging.destination.partition.id=1`, `messaging.kafka.offset=1`,
  `event.id=baec2f08-...`, `event.type=workout.finished` (no payload) - with
  `pg.query:BEGIN/SELECT/INSERT/COMMIT analytics` (the idempotent projection
  transaction) nested under it, confirming pg spans nest under the consumer
  span with no code change beyond the `consumerHook` above.

The matching Loki query (`{service=~".+"} | traceId="fd426b5c36caad41963998bb355a572b"`,
run through Grafana's datasource proxy) returned exactly two streams, `api`
and `analytics`, one line each:

```
api => {"level":30,...,"req":{"method":"POST","url":"/workouts/76/finish"},
  "requestId":"3dccc984-...","traceId":"fd426b5c...","spanId":"3875141f...",
  "res":{"statusCode":201},"msg":"request completed"}
analytics => {"level":30,...,"requestId":"system",
  "eventId":"baec2f08-...","eventType":"workout.finished",
  "traceId":"fd426b5c...","spanId":"110b89af...","msg":"event handled",
  "result":"applied","topic":"hit.workout.v1","partition":1,"offset":"1"}
```
