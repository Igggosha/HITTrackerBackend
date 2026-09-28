import {
  context,
  propagation,
  SpanKind,
  trace,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { KafkaJsInstrumentation } from '@opentelemetry/instrumentation-kafkajs';

export type TraceContext = { traceparent: string; tracestate?: string };
let sdk: NodeSDK | undefined;

// A pure function so no request URL with OAuth codes or tokens becomes a span attribute.
export function scrubUrl(url: string): string {
  return url.split('?')[0].split('#')[0];
}

export function activeTraceContext(): TraceContext | null {
  if (!trace.getSpanContext(context.active())) return null;
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers);
  return headers.traceparent
    ? {
        traceparent: headers.traceparent,
        ...(headers.tracestate ? { tracestate: headers.tracestate } : {}),
      }
    : null;
}

export function parentContext(headers: TraceContext | null): Context {
  return headers
    ? propagation.extract(context.active(), headers)
    : context.active();
}

export function producerSpan<T>(
  name: string,
  parent: TraceContext | null,
  fn: () => Promise<T>,
): Promise<T> {
  return trace
    .getTracer('hit-outbox-relay')
    .startActiveSpan(
      name,
      { kind: SpanKind.PRODUCER },
      parentContext(parent),
      async (span) => {
        try {
          return await fn();
        } catch (error) {
          span.recordException(error as Error);
          throw error;
        } finally {
          span.end();
        }
      },
    );
}

type KafkaHeaderValue = Buffer | string | (Buffer | string)[] | undefined;

function kafkaHeader(
  headers: Record<string, KafkaHeaderValue> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === undefined ? undefined : first.toString();
}

/**
 * `@opentelemetry/instrumentation-kafkajs` already wraps `consumer.run`'s
 * `eachMessage` in a CONSUMER span parented from the extracted `traceparent`
 * header (see docs/diploma/tracing.md), with messaging.system/destination/
 * partition/offset attributes and the message key. It does not know about
 * this app's own envelope, so this hook adds `event.id`/`event.type` from
 * the relay's `event-id`/`event-type` headers - never the message payload.
 */
export function kafkaConsumerHook(
  span: Span,
  info: { message: { headers?: Record<string, KafkaHeaderValue> } },
): void {
  const eventId = kafkaHeader(info.message.headers, 'event-id');
  const eventType = kafkaHeader(info.message.headers, 'event-type');
  if (eventId) span.setAttribute('event.id', eventId);
  if (eventType) span.setAttribute('event.type', eventType);
}

export function initTracing(serviceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    console.info('Tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT unset');
    return;
  }
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.version': process.env.npm_package_version ?? '0.0.1',
      'deployment.environment': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation({
        headersToSpanAttributes: {
          client: { requestHeaders: [], responseHeaders: [] },
          server: { requestHeaders: [], responseHeaders: [] },
        },
        requestHook: (span, request) => {
          const url = 'url' in request ? String(request.url ?? '') : '';
          if (url) {
            span.setAttribute('url.full', scrubUrl(url));
            span.setAttribute('http.url', scrubUrl(url));
            span.setAttribute('http.target', scrubUrl(url));
          }
          span.setAttribute('url.query', '');
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new KafkaJsInstrumentation({ consumerHook: kafkaConsumerHook }),
    ],
  });
  sdk.start();
}

/**
 * Flushes and shuts down the OpenTelemetry SDK. `initTracing` itself no
 * longer registers SIGTERM/SIGINT handlers: in a Nest process, shutting the
 * SDK down as soon as a signal arrives would close the trace exporter while
 * Nest is still running `onModuleDestroy`/`beforeApplicationShutdown` hooks
 * on other providers (e.g. `RelayService` flushing a final Kafka publish,
 * which opens a producer span) — those spans would end after the exporter
 * had already stopped accepting them and be lost. Callers are expected to
 * invoke this only once every other provider has torn down; see
 * `src/tracing/tracing-shutdown.hook.ts` (`onApplicationShutdown` is the
 * last of Nest's shutdown hooks) and `docs/diploma/tracing.md`.
 *
 * Safety net for a process with no Nest application/context at all (e.g. a
 * future standalone analytics consumer): such a process gets no
 * `onApplicationShutdown` ordering for free and must opt into
 * `installShutdownSignalHandlers` below, or call `shutdownTracing` from its
 * own signal handler, or it will simply lose in-flight spans on SIGTERM/
 * SIGINT (the process exiting is otherwise harmless — no data is
 * corrupted, only unflushed spans are dropped).
 */
export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}

/**
 * Opt-in safety net for non-Nest processes only. A Nest app/application
 * context must NOT call this: it already gets correct ordering via
 * `onApplicationShutdown` (see `shutdownTracing` above), and registering a
 * second, independent signal handler here would shut the SDK down too
 * early, racing the app's own shutdown hooks.
 */
export function installShutdownSignalHandlers(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void shutdownTracing();
    });
}
