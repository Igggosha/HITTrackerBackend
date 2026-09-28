// Thin entry point for the analytics consumer process: this must be the very
// first import in `services/analytics/src/main.ts`, before Nest, pg, or
// KafkaJS, so their auto-instrumentation patches modules before those modules
// are required elsewhere. Mirrors `src/tracing/register.ts` (the main API's
// entry) and `src/relay/register.ts` (the outbox relay's), defaulting the
// service name to `hit-analytics` instead of `hit-api`/`hit-relay`, since
// this is a separate deployable with its own identity in traces (see
// docs/diploma/tracing.md and docs/diploma/analytics-cqrs.md).
// `OTEL_SERVICE_NAME` still overrides the default when set.
import { initTracing } from '../../../../packages/tracing/tracing';

initTracing(process.env.OTEL_SERVICE_NAME ?? 'hit-analytics');
