import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A minimal query surface so the logic here can be unit-tested against a
 * fake client instead of a live `pg.Client`.
 */
export interface QueryableClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

/**
 * Migrations that predate this project running versioned Drizzle migrations
 * in Docker (see `docker/init-db.sh`). Their SQL has no `IF NOT EXISTS`
 * guards, so they are always recorded as applied once the pre-Drizzle
 * schema exists (checked by the caller before this list is used). Later
 * gaps between `sql/init.sql` and migration history (for example
 * `20260901013000_reconcile_docker_schema`) are closed by idempotent SQL
 * inside the migration itself instead of a baseline entry, and that pattern
 * remains the default choice for a new gap.
 */
export const baselineMigrations = [
  '20260810115352_robust_leopardon',
  '20260815144508_curved_hannibal_king',
];

export interface FingerprintedMigration {
  name: string;
  /**
   * Returns true when the live database already has this migration's full
   * effect, typically because `sql/init.sql` was re-exported from a
   * database where the migration had been applied out of order (directly,
   * or via `db:push`) before every earlier migration also ran in sequence.
   * When true, `db:baseline` records the migration as applied instead of
   * letting `db:migrate` re-run DDL that would fail against columns,
   * constraints, or indexes that already exist.
   *
   * Add an entry here only after confirming the fingerprint against the
   * actual refreshed dump; do not guess. See "Refreshing sql/init.sql" in
   * README.md.
   */
  isAlreadyApplied(client: QueryableClient): Promise<boolean>;
}

/**
 * Migrations whose changes may already be baked into `sql/init.sql`.
 * Detected by fingerprint (specific columns/constraints/indexes) rather
 * than a hardcoded assumption, so a future dump refresh cannot silently
 * reintroduce a fresh-volume migration failure.
 */
export const fingerprintedMigrations: FingerprintedMigration[] = [
  {
    name: '20260924090000_add_body_metrics_analytics',
    async isAlreadyApplied(client) {
      const { rows } = await client.query<{ present: boolean }>(`
        select
          exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'user_body_metrics'
              and column_name = 'waist_circumference'
          )
          and exists (
            select 1 from pg_constraint
            where conname = 'user_body_metrics_at_least_one_metric'
          )
          and exists (
            select 1 from pg_indexes
            where schemaname = 'public'
              and indexname = 'user_body_metrics_user_recorded_idx'
          ) as present
      `);
      return rows[0]?.present ?? false;
    },
  },
];

export function migrationTimestamp(name: string): number {
  const timestamp = name.slice(0, 14);
  return Date.UTC(
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)) - 1,
    Number(timestamp.slice(6, 8)),
    Number(timestamp.slice(8, 10)),
    Number(timestamp.slice(10, 12)),
    Number(timestamp.slice(12, 14)),
  );
}

/**
 * Records `name` as applied unless a row for it already exists, so this is
 * safe to call against a volume where `db:migrate` already applied the
 * migration for real. Returns whether a row was actually inserted, so
 * callers can log a baseline decision only the first time it takes effect.
 */
export async function recordMigrationIfMissing(
  client: QueryableClient,
  name: string,
): Promise<boolean> {
  const sql = await readFile(join('drizzle', name, 'migration.sql'));
  const hash = createHash('sha256').update(sql).digest('hex');

  const { rows } = await client.query<{ id: number }>(
    `
      insert into drizzle.__drizzle_migrations (hash, created_at, name)
      select $1, $2, $3
      where not exists (
        select 1 from drizzle.__drizzle_migrations where name = $3
      )
      returning id
    `,
    [hash, migrationTimestamp(name), name],
  );

  return rows.length > 0;
}
