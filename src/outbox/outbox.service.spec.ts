import { db } from '../db/db';
import { outboxEvents } from '../db/schema';
import { performedSetsPayload } from './events';
import { OutboxService, type ClaimedOutboxEvent } from './outbox.service';
import { calledWith, fakeOf, renderSql } from './testing/fake-database';
import type { DbTransaction } from './transaction';

jest.mock('../db/db', () =>
  jest
    .requireActual<typeof import('./testing/fake-database')>(
      './testing/fake-database',
    )
    .fakeDbModule(),
);

const fake = fakeOf(db);

const event = (id: string, occurredAt: string) => ({
  id,
  aggregateType: 'workout',
  aggregateId: '7',
  eventType: 'workout.finished',
  eventVersion: 1,
  payload: {},
  occurredAt: new Date(occurredAt),
  publishedAt: null,
  attempts: 0,
  lastError: null,
});

describe('OutboxService', () => {
  const outbox = new OutboxService();

  beforeEach(() => fake.reset());

  it('stores a typed, versioned event through the caller transaction', async () => {
    await fake.db.transaction((tx) =>
      outbox.enqueue(tx, {
        type: 'user.deleted',
        aggregateId: 5,
        payload: {
          userId: 5,
          deletedByUserId: 1,
          deletedAt: '2026-09-27T10:00:00.000Z',
        },
      }),
    );

    const [insert] = fake.committed('insert', outboxEvents);
    expect(insert.scope).toBe('tx');
    expect(calledWith(insert, 'values')[0].args[0]).toEqual({
      aggregateType: 'user',
      aggregateId: '5',
      eventType: 'user.deleted',
      eventVersion: 1,
      payload: {
        userId: 5,
        deletedByUserId: 1,
        deletedAt: '2026-09-27T10:00:00.000Z',
      },
    });
  });

  it('refuses the autocommit connection instead of a transaction', async () => {
    await expect(
      outbox.enqueue(db as unknown as DbTransaction, {
        type: 'user.registered',
        aggregateId: 1,
        payload: { userId: 1, method: 'email', registeredAt: 'x' },
      }),
    ).rejects.toThrow('requires the caller transaction');
    expect(fake.find('insert')).toHaveLength(0);
  });

  it('drops the event when the surrounding transaction rolls back', async () => {
    await expect(
      fake.db.transaction(async (tx) => {
        await outbox.enqueue(tx, {
          type: 'user.registered',
          aggregateId: 1,
          payload: { userId: 1, method: 'email', registeredAt: 'x' },
        });
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');

    expect(fake.find('insert', outboxEvents)).toHaveLength(1);
    expect(fake.committed('insert', outboxEvents)).toHaveLength(0);
  });

  it('claims the oldest unpublished events with FOR UPDATE SKIP LOCKED', async () => {
    fake.returns('select', outboxEvents, [event('a', '2026-09-27T10:00:00Z')]);

    const claimed = await fake.db.transaction((tx) =>
      outbox.claimBatch(tx, { limit: 25, maxAttempts: 3 }),
    );

    expect(claimed.map(({ id }) => id)).toEqual(['a']);
    const [select] = fake.find('select', outboxEvents);
    expect(calledWith(select, 'for')[0].args).toEqual([
      'update',
      { skipLocked: true },
    ]);
    expect(calledWith(select, 'limit')[0].args).toEqual([25]);
    const where = renderSql(calledWith(select, 'where')[0].args[0]);
    expect(where).toContain('"published_at" is null');
    expect(where).toContain('"attempts" <');
  });

  it('publishes in order and marks the whole batch published in one transaction', async () => {
    fake.returns('select', outboxEvents, [
      event('a', '2026-09-27T10:00:00Z'),
      event('b', '2026-09-27T10:00:01Z'),
    ]);
    const publish = jest.fn().mockResolvedValue(undefined);

    await expect(outbox.processBatch(publish)).resolves.toEqual({
      claimed: 2,
      published: ['a', 'b'],
      failed: null,
    });

    const published = publish.mock.calls as [ClaimedOutboxEvent][];
    expect(published.map(([claimed]) => claimed.id)).toEqual(['a', 'b']);
    const updates = fake.committed('update', outboxEvents);
    expect(updates).toHaveLength(1);
    expect(updates[0].scope).toBe('tx');
    expect(renderSql(calledWith(updates[0], 'where')[0].args[0])).toContain(
      '"published_at" is null',
    );
  });

  it('records the failure and stops so later events keep their order', async () => {
    fake.returns('select', outboxEvents, [
      event('a', '2026-09-27T10:00:00Z'),
      event('b', '2026-09-27T10:00:01Z'),
      event('c', '2026-09-27T10:00:02Z'),
    ]);
    const publish = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error('broker unavailable ' + 'x'.repeat(2000)),
      );

    const result = await outbox.processBatch(publish);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.published).toEqual(['a']);
    expect(result.failed?.id).toBe('b');
    expect(result.failed!.error.length).toBeLessThanOrEqual(1000);

    const [failure, published] = fake.committed('update', outboxEvents);
    const failureSet = calledWith(failure, 'set')[0].args[0] as Record<
      string,
      unknown
    >;
    expect(renderSql(failureSet.attempts)).toContain('"attempts" + 1');
    expect(failureSet.lastError).toMatch(/^Error: broker unavailable/);
    expect(published).toBeDefined();
  });

  it('does nothing when there is nothing to publish', async () => {
    const publish = jest.fn();
    await expect(outbox.processBatch(publish)).resolves.toEqual({
      claimed: 0,
      published: [],
      failed: null,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(fake.find('update')).toHaveLength(0);
  });

  it('sends max-attempt rows to the DLQ and marks only acknowledged rows', async () => {
    fake.returns('select', outboxEvents, [
      {
        ...event('a', '2026-09-27T10:00:00Z'),
        attempts: 10,
        lastError: 'broker down',
      },
    ]);
    const publish = jest.fn().mockResolvedValue(undefined);
    expect(await outbox.processDeadLetters(publish)).toEqual({
      claimed: 1,
      published: ['a'],
      failed: null,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', lastError: 'broker down' }),
    );
    const where = renderSql(
      calledWith(fake.find('select', outboxEvents)[0], 'where')[0].args[0],
    );
    expect(where).toContain('"attempts" >=');
    expect(fake.committed('update', outboxEvents)).toHaveLength(1);
  });

  it('keeps a row unpublished when DLQ delivery fails', async () => {
    fake.returns('select', outboxEvents, [
      { ...event('a', '2026-09-27T10:00:00Z'), attempts: 10 },
    ]);
    const result = await outbox.processDeadLetters(() => {
      throw new Error('dlq down');
    });
    expect(result.failed?.id).toBe('a');
    expect(fake.find('update', outboxEvents)).toHaveLength(0);
  });
});

describe('performedSetsPayload', () => {
  it('computes per-set and total volume', () => {
    expect(
      performedSetsPayload([
        {
          id: 1,
          exerciseId: 3,
          weight: 100,
          reps: 5,
          rpe: 8,
          isFailure: false,
          isDropSet: false,
        },
        {
          id: 2,
          exerciseId: 3,
          weight: 80,
          reps: 8,
          rpe: null,
          isFailure: true,
          isDropSet: true,
        },
        {
          id: 3,
          exerciseId: 4,
          weight: 0,
          reps: 12,
          rpe: null,
          isFailure: true,
          isDropSet: false,
        },
      ]),
    ).toEqual({
      setCount: 3,
      exerciseIds: [3, 4],
      totalVolume: 1140,
      sets: [
        {
          setId: 1,
          exerciseId: 3,
          weight: 100,
          reps: 5,
          rpe: 8,
          isFailure: false,
          isDropSet: false,
          volume: 500,
        },
        {
          setId: 2,
          exerciseId: 3,
          weight: 80,
          reps: 8,
          rpe: null,
          isFailure: true,
          isDropSet: true,
          volume: 640,
        },
        {
          setId: 3,
          exerciseId: 4,
          weight: 0,
          reps: 12,
          rpe: null,
          isFailure: true,
          isDropSet: false,
          volume: 0,
        },
      ],
    });
  });
});
