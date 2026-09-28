import { is, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbTransaction } from '../transaction';

/**
 * A scriptable stand-in for the drizzle `db` used by service unit tests.
 *
 * Every query builder chain is recorded (table, method calls such as
 * `.for('update')`, and whether it ran on `db` or inside a transaction).
 * Awaiting a chain resolves the next result queued for that operation and
 * table, or `[]`. A transaction whose callback throws marks its queries as
 * rolled back, which is how tests prove that an outbox row disappears with
 * the business change.
 *
 * Usage (the factory must not close over test variables, jest hoists it):
 *   jest.mock('../db/db', () =>
 *     jest.requireActual('../outbox/testing/fake-database').fakeDbModule());
 *   const fake = fakeOf(db);
 */

type Operation = 'select' | 'insert' | 'update' | 'delete' | 'execute';

export type RecordedQuery = {
  operation: Operation;
  scope: 'db' | 'tx';
  transactionId: number | null;
  calls: { method: string; args: unknown[] }[];
  rolledBack: boolean;
  table: unknown;
  /** Arguments of the root call, e.g. the SQL passed to `execute`. */
  args: unknown[];
};

type Scripted = { rows?: unknown[]; error?: unknown };

const dialect = new PgDialect();

export function renderSql(condition: unknown) {
  if (!is(condition, SQL)) return '';
  return dialect.sqlToQuery(condition).sql;
}

export class FakeDatabase {
  readonly queries: RecordedQuery[] = [];
  private readonly scripts = new Map<string, Scripted[]>();
  private readonly tableKeys = new Map<unknown, number>();
  private transactions = 0;

  readonly db = {
    select: (...args: unknown[]) => this.chain('select', null, args),
    insert: (...args: unknown[]) => this.chain('insert', null, args),
    update: (...args: unknown[]) => this.chain('update', null, args),
    delete: (...args: unknown[]) => this.chain('delete', null, args),
    execute: (...args: unknown[]) => this.chain('execute', null, args),
    transaction: <T>(callback: (tx: DbTransaction) => Promise<T>) =>
      this.runTransaction(callback),
    $fake: this as FakeDatabase,
  };

  /** Queues the rows the next matching query resolves with. */
  returns(operation: Operation, table: unknown, rows: unknown[]) {
    this.queue(operation, table, { rows });
    return this;
  }

  /** Makes the next matching query reject. */
  fails(operation: Operation, table: unknown, error: unknown) {
    this.queue(operation, table, { error });
    return this;
  }

  find(operation: Operation, table?: unknown) {
    return this.queries.filter(
      (query) =>
        query.operation === operation &&
        (table === undefined || query.table === table),
    );
  }

  committed(operation: Operation, table?: unknown) {
    return this.find(operation, table).filter((query) => !query.rolledBack);
  }

  reset() {
    this.queries.length = 0;
    this.scripts.clear();
    this.transactions = 0;
  }

  private key(operation: Operation, table: unknown) {
    if (!this.tableKeys.has(table))
      this.tableKeys.set(table, this.tableKeys.size);
    return `${operation}:${this.tableKeys.get(table)}`;
  }

  private queue(operation: Operation, table: unknown, scripted: Scripted) {
    const key = this.key(operation, table ?? null);
    if (!this.scripts.has(key)) this.scripts.set(key, []);
    this.scripts.get(key)!.push(scripted);
  }

  private async runTransaction<T>(callback: (tx: DbTransaction) => Promise<T>) {
    const transactionId = ++this.transactions;
    const tx = {
      select: (...args: unknown[]) => this.chain('select', transactionId, args),
      insert: (...args: unknown[]) => this.chain('insert', transactionId, args),
      update: (...args: unknown[]) => this.chain('update', transactionId, args),
      delete: (...args: unknown[]) => this.chain('delete', transactionId, args),
      execute: (...args: unknown[]) =>
        this.chain('execute', transactionId, args),
      rollback: () => {
        throw new Error('rollback');
      },
    };
    try {
      return await callback(tx as unknown as DbTransaction);
    } catch (error) {
      for (const query of this.queries) {
        if (query.transactionId === transactionId) query.rolledBack = true;
      }
      throw error;
    }
  }

  private chain(
    operation: Operation,
    transactionId: number | null,
    args: unknown[],
  ) {
    const query: RecordedQuery = {
      operation,
      scope: transactionId === null ? 'db' : 'tx',
      transactionId,
      calls: [],
      rolledBack: false,
      table: operation === 'select' || operation === 'execute' ? null : args[0],
      args,
    };
    this.queries.push(query);

    const resolve = () => {
      const table =
        operation === 'select'
          ? (query.calls.find((call) => call.method === 'from')?.args[0] ??
            null)
          : query.table;
      query.table = table;
      const next = this.scripts.get(this.key(operation, table))?.shift();
      // Scripted errors may be plain objects shaped like pg errors ({ code }).
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      if (next?.error) return Promise.reject(next.error);
      return Promise.resolve(next?.rows ?? []);
    };

    const chain: object = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'then') {
            return (
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => resolve().then(onFulfilled, onRejected);
          }
          return (...callArgs: unknown[]) => {
            query.calls.push({ method: String(property), args: callArgs });
            return chain;
          };
        },
      },
    );
    return chain;
  }
}

export function fakeDbModule() {
  return { db: new FakeDatabase().db };
}

export function fakeOf(db: unknown): FakeDatabase {
  return (db as { $fake: FakeDatabase }).$fake;
}

/** The rows passed to `.values(...)` of every committed insert into `table`. */
export function insertedValues(fake: FakeDatabase, table: unknown) {
  return fake
    .committed('insert', table)
    .map(
      (query) =>
        calledWith(query, 'values')[0].args[0] as Record<string, unknown>,
    );
}

export function calledWith(query: RecordedQuery | undefined, method: string) {
  return query?.calls.filter((call) => call.method === method) ?? [];
}
