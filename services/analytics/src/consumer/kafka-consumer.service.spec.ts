import type { Kafka } from 'kafkajs';
import { MetricsService } from '../metrics/metrics.service';
import { KafkaConsumerService, partitionLag } from './kafka-consumer.service';
import type { MessageHandler } from './message-handler';

type EachMessage = (payload: {
  topic: string;
  partition: number;
  message: {
    offset: string;
    key: Buffer | null;
    value: Buffer | null;
    headers: object;
  };
  heartbeat: () => Promise<void>;
}) => Promise<void>;

function fakeKafka() {
  const calls: string[] = [];
  let eachMessage: EachMessage | undefined;
  let runOptions: { autoCommit?: boolean } = {};
  const consumer = {
    events: { CRASH: 'crash', GROUP_JOIN: 'join' },
    on: jest.fn(),
    connect: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn(() => Promise.resolve()),
    run: jest.fn(
      (options: { autoCommit?: boolean; eachMessage: EachMessage }) => {
        runOptions = options;
        eachMessage = options.eachMessage;
        return Promise.resolve();
      },
    ),
    commitOffsets: jest.fn((offsets: unknown) => {
      calls.push(`commit ${JSON.stringify(offsets)}`);
      return Promise.resolve();
    }),
    disconnect: jest.fn(() => Promise.resolve()),
  };
  const kafka = {
    consumer: () => consumer,
    admin: jest.fn(),
  } as unknown as Kafka;
  return {
    kafka,
    consumer,
    calls,
    deliver: (offset: string) =>
      eachMessage!({
        topic: 'hit.workout.v1',
        partition: 2,
        message: { offset, key: null, value: Buffer.from('{}'), headers: {} },
        heartbeat: () => Promise.resolve(),
      }),
    runOptions: () => runOptions,
  };
}

async function started(handle: MessageHandler['handle']) {
  const fake = fakeKafka();
  const handler = { handle, stop: jest.fn() } as unknown as MessageHandler;
  const service = new KafkaConsumerService(
    fake.kafka,
    handler,
    new MetricsService(),
  );
  service.onApplicationBootstrap();
  await new Promise((resolve) => setImmediate(resolve));
  return { ...fake, service };
}

describe('KafkaConsumerService', () => {
  it('runs with autoCommit off and commits offset+1 only after the handler resolved', async () => {
    const calls: string[] = [];
    const fake = await started(async () => {
      calls.push('handle');
      return Promise.resolve('applied' as const);
    });
    expect(fake.consumer.subscribe).toHaveBeenCalledWith({
      topics: ['hit.workout.v1', 'hit.user.v1'],
      fromBeginning: true,
    });
    expect(fake.runOptions().autoCommit).toBe(false);

    await fake.deliver('41');
    expect(calls).toEqual(['handle']);
    expect(fake.consumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'hit.workout.v1', partition: 2, offset: '42' },
    ]);
    await fake.service.beforeApplicationShutdown();
  });

  it('never commits when the handler fails (the message is redelivered)', async () => {
    const fake = await started(() => Promise.reject(new Error('db down')));
    await expect(fake.deliver('41')).rejects.toThrow('db down');
    expect(fake.consumer.commitOffsets).not.toHaveBeenCalled();
    await fake.service.beforeApplicationShutdown();
  });

  it('retries a failed start with backoff instead of crashing the service', async () => {
    const fake = fakeKafka();
    fake.consumer.connect
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
      .mockImplementation(() => Promise.resolve());
    const handler = {
      handle: jest.fn(),
      stop: jest.fn(),
    } as unknown as MessageHandler;
    jest.useFakeTimers();
    try {
      const service = new KafkaConsumerService(
        fake.kafka,
        handler,
        new MetricsService(),
      );
      service.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1_100);
      expect(fake.consumer.connect).toHaveBeenCalledTimes(2);
      expect(fake.consumer.run).toHaveBeenCalledTimes(1);
      await service.beforeApplicationShutdown();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('partitionLag', () => {
  it('is high watermark minus the committed offset', () => {
    expect(partitionLag({ high: '16', low: '0' }, '12')).toBe(4);
    expect(partitionLag({ high: '16', low: '0' }, '16')).toBe(0);
  });

  it('counts from the low watermark without a commit (-1) or after a reset to earliest (-2)', () => {
    expect(partitionLag({ high: '10', low: '3' }, undefined)).toBe(7);
    expect(partitionLag({ high: '10', low: '3' }, '-1')).toBe(7);
    expect(partitionLag({ high: '0', low: '0' }, '-2')).toBe(0);
  });
});
