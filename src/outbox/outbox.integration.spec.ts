import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Client, Pool } from 'pg';
import { outboxEvents } from '../db/schema';
import { OutboxService } from './outbox.service';
import type { DbTransaction } from './transaction';

// Runs only against a disposable database:
//   OUTBOX_IT_DATABASE_URL=postgresql://... npx jest src/outbox/outbox.integration.spec.ts
// Everything happens in a throwaway schema that is dropped afterwards.
const url = process.env.OUTBOX_IT_DATABASE_URL;
const describeWithDatabase = url ? describe : describe.skip;

describeWithDatabase('outbox against PostgreSQL', () => {
  const schema = `outbox_it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const outbox = new OutboxService();
  let pool: Pool;
  let database: ReturnType<typeof drizzle>;

  const transaction = <T>(work: (tx: DbTransaction) => Promise<T>) =>
    database.transaction((tx) => work(tx as unknown as DbTransaction));
  const event = (aggregateId: number) => ({
    type: 'user.registered' as const,
    aggregateId,
    payload: {
      userId: aggregateId,
      method: 'email' as const,
      registeredAt: new Date().toISOString(),
    },
  });

  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema ${schema}`);
    await admin.end();
    pool = new Pool({
      connectionString: url,
      options: `-c search_path=${schema}`,
    });
    database = drizzle({ client: pool });
    // `trace_context` was added by a later migration; both must run for the
    // `traceContext` column `OutboxService.enqueue` writes to exist.
    const migrations = [
      '../../drizzle/20260928090000_add_outbox_events/migration.sql',
      '../../drizzle/20260928110000_add_outbox_trace_context/migration.sql',
    ];
    for (const path of migrations) {
      const migration = readFileSync(join(__dirname, path), 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) {
        await pool.query(statement);
      }
    }
  });

  afterAll(async () => {
    await pool?.query(`drop schema ${schema} cascade`);
    await pool?.end();
  });

  beforeEach(() => pool.query('truncate outbox_events'));

  it('keeps no event when the business transaction rolls back', async () => {
    await expect(
      transaction(async (tx) => {
        await outbox.enqueue(tx, event(1));
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');
    await transaction((tx) => outbox.enqueue(tx, event(2)));

    const rows = await database.select().from(outboxEvents);
    expect(rows.map((row) => row.aggregateId)).toEqual(['2']);
    expect(rows[0]).toMatchObject({
      aggregateType: 'user',
      eventType: 'user.registered',
      eventVersion: 1,
      attempts: 0,
      publishedAt: null,
    });
  });

  it('notifies only after commit and never after rollback', async () => {
    const listener = new Client({ connectionString: url });
    await listener.connect();
    const notifications: string[] = [];
    listener.on('notification', (message) =>
      notifications.push(message.payload ?? ''),
    );
    try {
      await listener.query('LISTEN outbox_events');
      await expect(
        transaction(async (tx) => {
          await outbox.enqueue(tx, event(1));
          await new Promise((resolve) => setTimeout(resolve, 30));
          expect(notifications).toEqual([]);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(notifications).toEqual([]);
      await transaction((tx) => outbox.enqueue(tx, event(2)));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(notifications).toEqual(['']);
    } finally {
      await listener.end();
    }
  });

  it('gives concurrent relays disjoint batches with SKIP LOCKED', async () => {
    for (let id = 1; id <= 5; id++) {
      await transaction((tx) => outbox.enqueue(tx, event(id)));
    }

    let releaseFirst!: () => void;
    const firstHolding = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstClaimed: string[] = [];
    let signalClaimed!: () => void;
    const claimed = new Promise<void>((resolve) => {
      signalClaimed = resolve;
    });

    const first = transaction(async (tx) => {
      firstClaimed = (await outbox.claimBatch(tx, { limit: 3 })).map(
        (row) => row.aggregateId,
      );
      signalClaimed();
      await firstHolding;
    });
    await claimed;

    // The first relay still holds its locks: the second one skips them
    // instead of waiting, and never sees the same events.
    const second = await transaction(async (tx) =>
      (await outbox.claimBatch(tx, { limit: 3 })).map((row) => row.aggregateId),
    );
    releaseFirst();
    await first;

    expect(firstClaimed).toEqual(['1', '2', '3']);
    expect(second).toEqual(['4', '5']);
  });

  it('marks published rows and parks an event after too many failures', async () => {
    await transaction((tx) => outbox.enqueue(tx, event(1)));
    await transaction((tx) => outbox.enqueue(tx, event(2)));
    const [a, b] = await database
      .select()
      .from(outboxEvents)
      .orderBy(outboxEvents.occurredAt);

    await transaction(async (tx) => {
      await outbox.markPublished(tx, [a.id]);
      await outbox.recordFailure(tx, b.id, new Error('broker down'));
      await outbox.recordFailure(tx, b.id, new Error('broker down'));
    });

    const unpublished = await transaction((tx) =>
      outbox.claimBatch(tx, { maxAttempts: 3 }),
    );
    expect(unpublished.map((row) => row.id)).toEqual([b.id]);
    expect(unpublished[0]).toMatchObject({
      attempts: 2,
      lastError: 'Error: broker down',
    });
    await expect(
      transaction((tx) => outbox.claimBatch(tx, { maxAttempts: 2 })),
    ).resolves.toEqual([]);

    const [published] = await database
      .select()
      .from(outboxEvents)
      .where(sql`${outboxEvents.id} = ${a.id}`);
    expect(published.publishedAt).toBeInstanceOf(Date);
  });

  it('uses the partial index for the relay query', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = $1 and indexname = 'outbox_events_unpublished_idx'`,
      [schema],
    );
    expect(rows[0].indexdef).toMatch(/WHERE \(published_at IS NULL\)/);
  });
});
