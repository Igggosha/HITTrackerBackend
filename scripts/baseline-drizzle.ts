import { Client } from 'pg';
import {
  baselineMigrations,
  fingerprintedMigrations,
  recordMigrationIfMissing,
} from './baseline-drizzle.logic';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to baseline Drizzle migrations.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tables = await client.query<{ exercises: string | null }>(
      "select to_regclass('public.exercises') as exercises",
    );
    if (!tables.rows[0]?.exercises) {
      throw new Error('The initial database schema is missing; cannot create a Drizzle baseline.');
    }

    await client.query('create schema if not exists drizzle');
    await client.query(`
      create table if not exists drizzle.__drizzle_migrations (
        id serial primary key,
        hash text not null,
        created_at bigint,
        name text,
        applied_at timestamp with time zone default now()
      )
    `);

    for (const name of baselineMigrations) {
      await recordMigrationIfMissing(client, name);
    }

    for (const migration of fingerprintedMigrations) {
      if (await migration.isAlreadyApplied(client)) {
        const inserted = await recordMigrationIfMissing(client, migration.name);
        if (inserted) {
          console.log(
            `db:baseline: ${migration.name} already matches sql/init.sql, recording it as applied.`,
          );
        }
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
