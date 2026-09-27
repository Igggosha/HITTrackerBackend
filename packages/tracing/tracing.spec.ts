import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { db } from '../../src/db/db';
import { outboxEvents } from '../../src/db/schema';
import { OutboxService } from '../../src/outbox/outbox.service';
import { calledWith, fakeOf } from '../../src/outbox/testing/fake-database';
import { RelayService } from '../../src/relay/relay.service';
import {
  activeTraceContext,
  initTracing,
  installShutdownSignalHandlers,
  scrubUrl,
  shutdownTracing,
} from './tracing';

jest.mock('../../src/db/db', () =>
  jest
    .requireActual<typeof import('../../src/outbox/testing/fake-database')>(
      '../../src/outbox/testing/fake-database',
    )
    .fakeDbModule(),
);

const fake = fakeOf(db);

it('disables tracing without an endpoint and removes sensitive query strings', () => {
  const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const log = jest.spyOn(console, 'info').mockImplementation();
  initTracing('hit-api');
  expect(log).toHaveBeenCalledWith(
    'Tracing disabled: OTEL_EXPORTER_OTLP_ENDPOINT unset',
  );
  expect(scrubUrl('/auth/callback?code=secret&token=secret#frag')).toBe(
    '/auth/callback',
  );
  log.mockRestore();
  if (previous !== undefined)
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
});

it('stores an active parent and continues it when publishing to Kafka', async () => {
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(provider);
  try {
    fake.reset();
    const outbox = new OutboxService();
    const send = jest.fn().mockResolvedValue(undefined);
    const relay = new RelayService(outbox, {} as never);
    (relay as unknown as { producer: { send: typeof send } }).producer = {
      send,
    };
    const request = trace.getTracer('test').startSpan('request');
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      aggregateType: 'workout',
      aggregateId: '9',
      eventType: 'workout.finished',
      eventVersion: 1,
      payload: { workoutId: 9, userId: 42 },
      occurredAt: new Date(),
      publishedAt: null,
      attempts: 0,
      lastError: null,
    };
    await context.with(trace.setSpan(context.active(), request), async () => {
      await fake.db.transaction((tx) =>
        outbox.enqueue(tx, {
          type: 'user.registered',
          aggregateId: 42,
          payload: {
            userId: 42,
            method: 'email',
            registeredAt: '2026-09-28T12:00:00Z',
          },
        }),
      );
    });
    const [insert] = fake.committed('insert', outboxEvents);
    const stored = calledWith(insert, 'values')[0].args[0] as {
      traceContext: { traceparent: string };
    };
    expect(stored.traceContext.traceparent).toContain(
      request.spanContext().traceId,
    );
    await (
      relay as unknown as {
        publish: (row: unknown, dlq: boolean) => Promise<void>;
      }
    ).publish({ ...row, traceContext: stored.traceContext }, false);
    const headers = (
      send.mock.calls as [
        { messages: [{ headers: { traceparent: string } }] },
      ][]
    )[0][0].messages[0].headers;
    expect(headers.traceparent).toContain(request.spanContext().traceId);
    const producer = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'publish hit.workout.v1');
    expect(producer?.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    request.end();
    expect(activeTraceContext()).toBeNull();
    await fake.db.transaction((tx) =>
      outbox.enqueue(tx, {
        type: 'user.registered',
        aggregateId: 43,
        payload: {
          userId: 43,
          method: 'email',
          registeredAt: '2026-09-28T12:00:00Z',
        },
      }),
    );
    const noSpan = fake.committed('insert', outboxEvents)[1];
    expect(calledWith(noSpan, 'values')[0].args[0]).not.toHaveProperty(
      'traceContext',
    );
  } finally {
    trace.disable();
    propagation.disable();
    context.disable();
    manager.disable();
    await provider.shutdown();
  }
});

it('does not register SIGTERM/SIGINT itself; installShutdownSignalHandlers and shutdownTracing are opt-in', async () => {
  const previous = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const log = jest.spyOn(console, 'info').mockImplementation();
  const beforeTerm = process.listeners('SIGTERM');
  const beforeInt = process.listeners('SIGINT');

  initTracing('hit-api');
  expect(process.listeners('SIGTERM')).toEqual(beforeTerm);
  expect(process.listeners('SIGINT')).toEqual(beforeInt);

  installShutdownSignalHandlers();
  const addedTerm = process
    .listeners('SIGTERM')
    .filter((listener) => !beforeTerm.includes(listener));
  const addedInt = process
    .listeners('SIGINT')
    .filter((listener) => !beforeInt.includes(listener));
  expect(addedTerm).toHaveLength(1);
  expect(addedInt).toHaveLength(1);
  addedTerm.forEach((listener) =>
    process.removeListener('SIGTERM', listener as () => void),
  );
  addedInt.forEach((listener) =>
    process.removeListener('SIGINT', listener as () => void),
  );

  await expect(shutdownTracing()).resolves.toBeUndefined();
  log.mockRestore();
  if (previous !== undefined)
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previous;
});
