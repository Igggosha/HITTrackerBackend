import { EventValidator } from '../events/event-validator';
import { MetricsService } from '../metrics/metrics.service';
import { Projector } from '../projections/projector';
import { InMemoryReadModelStore } from '../projections/testing/in-memory-store';
import { workoutFinished } from '../projections/testing/fixtures';
import {
  MessageHandler,
  type DeadLetter,
  type IncomingMessage,
} from './message-handler';

function setup(maxAttempts = 3) {
  const store = new InMemoryReadModelStore();
  const dlq: DeadLetter[] = [];
  const metrics = new MetricsService();
  const handler = new MessageHandler(
    new EventValidator(),
    new Projector(store),
    metrics,
    (message) => {
      dlq.push(message);
      return Promise.resolve();
    },
    { maxAttempts, retryBaseMs: 1, retryMaxMs: 5 },
  );
  return { store, dlq, handler, metrics };
}

const message = (value: unknown, offset = '42'): IncomingMessage => ({
  topic: 'hit.workout.v1',
  partition: 1,
  offset,
  key: '7',
  value: typeof value === 'string' ? value : JSON.stringify(value),
  headers: { 'event-id': 'header-id', 'event-type': 'workout.finished' },
});

const valid = () =>
  workoutFinished({
    workoutId: 1,
    finishedAt: '2026-09-28T10:00:00.000Z',
    sets: [{ exerciseId: 3, weight: 60, reps: 10 }],
  });

describe('MessageHandler', () => {
  it('applies a valid event once; a redelivery is a duplicate', async () => {
    const { store, handler } = setup();
    const event = valid();
    await expect(handler.handle(message(event))).resolves.toBe('applied');
    await expect(handler.handle(message(event))).resolves.toBe('duplicate');
    expect(store.state.workouts.size).toBe(1);
  });

  it('skips an unknown event version without touching the store or the DLQ', async () => {
    const { store, dlq, handler, metrics } = setup();
    await expect(
      handler.handle(message({ ...valid(), version: 99 })),
    ).resolves.toBe('skipped_unknown');
    expect(store.state.processed).toEqual([]);
    expect(dlq).toEqual([]);
    const counter = await metrics.eventsProcessed.get();
    expect(counter.values).toContainEqual(
      expect.objectContaining({
        labels: { type: 'workout.finished', result: 'skipped_unknown' },
      }),
    );
  });

  it('sends an invalid event to the DLQ after N attempts, with error headers', async () => {
    const { store, dlq, handler } = setup(3);
    const invalid = {
      ...valid(),
      payload: { ...valid().payload, sets: 'nope' },
    };
    await expect(handler.handle(message(invalid, '17'))).resolves.toBe(
      'dead_lettered',
    );
    expect(dlq).toHaveLength(1);
    expect(dlq[0].value).toBe(JSON.stringify(invalid));
    expect(dlq[0].key).toBe('7');
    expect(dlq[0].headers).toMatchObject({
      'event-id': 'header-id',
      'dlq-reason': 'invalid',
      'dlq-attempts': '3',
      'dlq-consumer-group': 'analytics',
      'dlq-source-topic': 'hit.workout.v1',
      'dlq-source-partition': '1',
      'dlq-source-offset': '17',
    });
    expect(dlq[0].headers['dlq-error']).toContain('/payload/sets');
    expect(store.state.processed).toEqual([]);
  });

  it('dead-letters malformed JSON without echoing the body', async () => {
    const { dlq, handler } = setup(1);
    await expect(handler.handle(message('{"secret": 1'))).resolves.toBe(
      'dead_lettered',
    );
    expect(dlq[0].headers['dlq-error']).toBe(
      'Error: message value is not valid JSON',
    );
  });

  it('retries a transient database failure (not counted towards N) and then applies', async () => {
    const { store, dlq, handler } = setup(1);
    const outage = Object.assign(
      new Error('connect ECONNREFUSED 10.0.0.1:5432'),
      {
        code: 'ECONNREFUSED',
      },
    );
    store.failures.push(outage, outage, outage);
    const heartbeat = jest.fn(() => Promise.resolve());
    await expect(handler.handle(message(valid()), heartbeat)).resolves.toBe(
      'applied',
    );
    expect(dlq).toEqual([]);
    expect(heartbeat).toHaveBeenCalled();
  });

  it('keeps retrying (never resolves) while the DLQ itself is unavailable', async () => {
    const store = new InMemoryReadModelStore();
    let attempts = 0;
    const handler = new MessageHandler(
      new EventValidator(),
      new Projector(store),
      new MetricsService(),
      () =>
        ++attempts < 3
          ? Promise.reject(new Error('broker down'))
          : Promise.resolve(),
      { maxAttempts: 1, retryBaseMs: 1, retryMaxMs: 2 },
    );
    await expect(handler.handle(message('garbage'))).resolves.toBe(
      'dead_lettered',
    );
    expect(attempts).toBe(3);
  });
});
