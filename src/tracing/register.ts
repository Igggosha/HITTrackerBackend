// Thin entry point for the API process: this must be the very first import
// in `src/main.ts`, before Nest, pg, or KafkaJS, so their auto-instrumentation
// patches modules before those modules are required elsewhere. The
// Nest-independent bootstrap itself lives in `packages/tracing/tracing.ts`
// (same convention as `packages/event-contracts`), so it can be reused by a
// future standalone process (e.g. an analytics consumer) without pulling in
// Nest. The relay process has its own thin entry, `src/relay/register.ts`,
// defaulting to `hit-relay` instead of `hit-api`.
import { initTracing } from '../../packages/tracing/tracing';

initTracing(process.env.OTEL_SERVICE_NAME ?? 'hit-api');
