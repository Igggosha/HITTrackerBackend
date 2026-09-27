import {
  envelopeFrom,
  eventKey,
  topicFor,
} from '../../packages/event-contracts/events';
import { RelayService } from './relay.service';

const send = jest.fn().mockResolvedValue(undefined);
const connect = jest.fn().mockResolvedValue(undefined);
const disconnect = jest.fn().mockResolvedValue(undefined);
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => ({ send, connect, disconnect }),
  })),
}));

const row = {
  id: '00000000-0000-4000-8000-000000000001',
  eventType: 'workout.finished',
  eventVersion: 1,
  aggregateType: 'workout',
  aggregateId: '9',
  occurredAt: new Date('2026-09-28T12:00:00Z'),
  payload: { workoutId: 9, userId: 42 },
  attempts: 0,
  lastError: null as string | null,
};

const metrics = {
  outboxPublished: { inc: jest.fn() },
  outboxPublishFailures: { inc: jest.fn() },
};

describe('event contracts', () => {
  it('routes every family and keys workout events by user', () => {
    expect(topicFor('workout.finished')).toBe('hit.workout.v1');
    for (const type of [
      'user.deleted',
      'program.scheduled',
      'body_metric.recorded',
    ] as const)
      expect(topicFor(type)).toBe('hit.user.v1');
    expect(eventKey(row.payload)).toBe('42');
    expect(envelopeFrom(row)).toEqual({
      id: row.id,
      type: row.eventType,
      version: 1,
      occurredAt: '2026-09-28T12:00:00.000Z',
      aggregateType: 'workout',
      aggregateId: '9',
      payload: row.payload,
    });
  });
});

describe('RelayService', () => {
  const prior = process.env.KAFKA_BROKERS;
  afterEach(() => {
    if (prior === undefined) delete process.env.KAFKA_BROKERS;
    else process.env.KAFKA_BROKERS = prior;
    jest.clearAllMocks();
  });

  it('does not connect when brokers are unset', async () => {
    delete process.env.KAFKA_BROKERS;
    const relay = new RelayService({} as never, metrics as never);
    relay.onModuleInit();
    await relay.onModuleDestroy();
    expect(connect).not.toHaveBeenCalled();
  });

  it('publishes a normal batch and acknowledges DLQ rows', async () => {
    process.env.KAFKA_BROKERS = 'kafka:9092';
    const outbox = {
      processDeadLetters: jest.fn(
        async (publish: (event: typeof row) => Promise<void>) => {
          await publish({ ...row, attempts: 10, lastError: 'broker down' });
          return { claimed: 1, published: [row.id], failed: null };
        },
      ),
      processBatch: jest.fn(
        async (publish: (event: typeof row) => Promise<void>) => {
          await publish(row);
          return { claimed: 1, published: [row.id], failed: null };
        },
      ),
    };
    const relay = new RelayService(outbox as never, metrics as never);
    relay.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await relay.onModuleDestroy();
    expect(send).toHaveBeenCalledTimes(2);
    const calls = send.mock.calls as unknown[][];
    expect(calls[0][0]).toMatchObject({
      topic: 'hit.events.dlq',
      acks: -1,
      messages: [{ key: '42', headers: { 'last-error': 'broker down' } }],
    });
    expect(calls[1][0]).toMatchObject({
      topic: 'hit.workout.v1',
      messages: [{ key: '42', headers: { 'event-id': row.id } }],
    });
    expect(disconnect).toHaveBeenCalled();
  });

  it('counts publish failure and waits before retrying', async () => {
    process.env.KAFKA_BROKERS = 'kafka:9092';
    const outbox = {
      processDeadLetters: jest
        .fn()
        .mockResolvedValue({ claimed: 0, published: [], failed: null }),
      processBatch: jest.fn().mockResolvedValue({
        claimed: 1,
        published: [],
        failed: { id: row.id, error: 'down' },
      }),
    };
    const relay = new RelayService(outbox as never, metrics as never);
    relay.onModuleInit();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await relay.onModuleDestroy();
    expect(metrics.outboxPublishFailures.inc).toHaveBeenCalledWith(1);
    expect(outbox.processBatch).toHaveBeenCalledTimes(1);
  });

  describe('bounded broker calls', () => {
    const priorTimeout = process.env.RELAY_PUBLISH_TIMEOUT_MS;
    const priorPoll = process.env.RELAY_POLL_INTERVAL_MS;

    afterEach(() => {
      if (priorTimeout === undefined)
        delete process.env.RELAY_PUBLISH_TIMEOUT_MS;
      else process.env.RELAY_PUBLISH_TIMEOUT_MS = priorTimeout;
      if (priorPoll === undefined) delete process.env.RELAY_POLL_INTERVAL_MS;
      else process.env.RELAY_POLL_INTERVAL_MS = priorPoll;
      // Restore the shared `send` mock so later tests in this file (if any
      // are added) do not inherit a producer that never resolves.
      send.mockReset();
      send.mockResolvedValue(undefined);
    });

    it('rejects publish() within RELAY_PUBLISH_TIMEOUT_MS when the broker never answers', async () => {
      process.env.KAFKA_BROKERS = 'kafka:9092';
      process.env.RELAY_PUBLISH_TIMEOUT_MS = '20';
      send.mockImplementation(() => new Promise(() => {}));
      const relay = new RelayService({} as never, metrics as never);
      relay.onModuleInit();

      const started = Date.now();
      await expect(
        (
          relay as unknown as {
            publish: (event: typeof row, deadLetter: boolean) => Promise<void>;
          }
        ).publish(row, false),
      ).rejects.toThrow('Kafka publish timed out after 20ms');
      expect(Date.now() - started).toBeLessThan(200);

      await relay.onModuleDestroy();
    });

    it('keeps polling and recording failures when every batch hangs at the broker', async () => {
      process.env.KAFKA_BROKERS = 'kafka:9092';
      process.env.RELAY_PUBLISH_TIMEOUT_MS = '20';
      process.env.RELAY_POLL_INTERVAL_MS = '10';
      send.mockImplementation(() => new Promise(() => {}));
      const outbox = {
        processDeadLetters: jest
          .fn()
          .mockResolvedValue({ claimed: 0, published: [], failed: null }),
        processBatch: jest.fn(
          async (publish: (event: typeof row) => Promise<void>) => {
            try {
              await publish(row);
              return { claimed: 1, published: [row.id], failed: null };
            } catch (error) {
              return {
                claimed: 1,
                published: [],
                failed: {
                  id: row.id,
                  error: error instanceof Error ? error.message : String(error),
                },
              };
            }
          },
        ),
      };
      const relay = new RelayService(outbox as never, metrics as never);
      relay.onModuleInit();
      await new Promise((resolve) => setTimeout(resolve, 80));
      await relay.onModuleDestroy();

      // Every iteration's hung send settled (as a failure) within the
      // timeout instead of wedging the loop, so the relay polled more than
      // once in this window.
      expect(outbox.processBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(metrics.outboxPublishFailures.inc).toHaveBeenCalled();
    });
  });
});
