import { AsyncLocalStorage } from 'node:async_hooks';

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

/** pino `mixin`: merged into every log line. */
export function logMixin(): Record<string, string> {
  return {
    requestId: requestIds.getStore() ?? 'system',
    ...eventContext.getStore(),
  };
}
