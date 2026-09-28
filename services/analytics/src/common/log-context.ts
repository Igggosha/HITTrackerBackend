import { AsyncLocalStorage } from 'node:async_hooks';
import { context, trace } from '@opentelemetry/api';

/** Request id of the HTTP request being handled (see request-id.ts). */
export const requestIds = new AsyncLocalStorage<string>();

/**
 * Ids of the Kafka event being handled. Every log line written while a
 * message is processed carries `eventId`/`eventType` (never the payload), so
 * Loki/Alloy can filter one event's history like an HTTP request's.
 */
export const eventContext = new AsyncLocalStorage<{
  eventId: string;
  eventType: string;
}>();

/**
 * pino `mixin`: merged into every log line. Same shape as the main API's
 * (`src/app.module.ts`): `traceId`/`spanId` come from the OTel span active
 * when the line is written (the CONSUMER span wrapping a Kafka message, or
 * the HTTP span for a proxied request), and are `null` when tracing is off
 * or nothing is active - Alloy/Loki treat that the same way for both
 * services (see docs/diploma/tracing.md, docs/diploma/observability.md).
 */
export function logMixin(): Record<string, string | null> {
  const span = trace.getSpanContext(context.active());
  return {
    requestId: requestIds.getStore() ?? 'system',
    ...eventContext.getStore(),
    traceId: span?.traceId ?? null,
    spanId: span?.spanId ?? null,
  };
}
