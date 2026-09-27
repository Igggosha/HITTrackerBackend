# Distributed tracing

A trace follows one operation across processes. Its spans describe work such as
HTTP handling, SQL, and Kafka publication. W3C `traceparent` carries the trace
and parent span IDs; `tracestate` carries optional vendor state. Metrics show
something is wrong, traces show where, and logs explain why.

`src/tracing/register.ts` loads first in each entry point, before Nest, pg, or
KafkaJS. `initTracing(serviceName)` is Nest independent and can be reused by
the analytics consumer. An empty `OTEL_EXPORTER_OTLP_ENDPOINT` disables the SDK.
The SDK uses `OTEL_TRACES_SAMPLER=parentbased_always_on` by default; production
can use `parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1`.
HTTP URL query strings and credential headers are excluded from span attributes.
SQL parameters and HTTP bodies are never enabled. `X-Trace-Id` is exposed by
CORS; pino logs contain the current `traceId` and `spanId` beside `requestId`.

The outbox commits a nullable W3C context beside each event. The relay runs
later in another process, so automatic instrumentation cannot infer the parent.
It extracts that context and starts a producer span as a child of the enqueue
span, then passes its context in Kafka headers. This parent relationship treats
publish as deferred work caused by the original request. The KafkaJS auto
instrumentation may replace the same header keys with its nested send span;
there is still one trace and one value per header. A consumer extracts those
headers and starts a CONSUMER span. See `packages/event-contracts/TRACING.md`.

Jaeger all-in-one 1.76 is used because v2 requires a separate collector/storage
configuration for this local demo. Its in-memory store is capped at 10,000
traces and 512 MB; it loses traces on restart. The UI binds to loopback only.
Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` in the Compose env file
when enabling the observability profile. Tracing stays off by default.

## Demo

1. Start `docker compose --profile observability --profile events up --build`.
2. Log in and finish a workout through the API. Copy `X-Trace-Id` from the
   finish response.
3. Open `http://127.0.0.1:16686`, search service `hit-api`, and inspect the
   trace ID. The HTTP server and pg spans precede the later `hit-relay`
   producer span. Grafana also provisions Jaeger as datasource `jaeger`.
4. Search the same trace ID in JSON pino logs. When Loki is merged, add a Loki
   derived field regex `"traceId":"([a-f0-9]{32})"` pointing at datasource
   `jaeger` with URL `${__value.raw}`.
