import {
  context,
  propagation,
  SpanKind,
  trace,
  type Context,
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
      new KafkaJsInstrumentation(),
    ],
  });
  sdk.start();
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => {
      void sdk?.shutdown();
    });
}
