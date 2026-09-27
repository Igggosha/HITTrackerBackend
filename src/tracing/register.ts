import { initTracing } from './tracing';

initTracing(process.env.OTEL_SERVICE_NAME ?? 'hit-api');
