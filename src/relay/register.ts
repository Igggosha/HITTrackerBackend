// Thin entry point for the standalone outbox relay process: this must be the
// very first import in `src/relay/main.ts`, before Nest, pg, or KafkaJS. It
// mirrors `src/tracing/register.ts` (the API's entry) but defaults the
// service name to `hit-relay` instead of `hit-api`, since this process is a
// separate deployable with its own identity in traces (see
// docs/diploma/tracing.md). `OTEL_SERVICE_NAME` still overrides either
// default when set.
import { initTracing } from '../../packages/tracing/tracing';

initTracing(process.env.OTEL_SERVICE_NAME ?? 'hit-relay');
