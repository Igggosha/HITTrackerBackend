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
});
