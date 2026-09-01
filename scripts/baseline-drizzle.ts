import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

const baselineMigrations = [
  '20260810115352_robust_leopardon',
  '20260815144508_curved_hannibal_king',
];

function migrationTimestamp(name: string): number {
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
      const sql = await readFile(join('drizzle', name, 'migration.sql'));
      const hash = createHash('sha256').update(sql).digest('hex');

      await client.query(
        `
          insert into drizzle.__drizzle_migrations (hash, created_at, name)
          select $1, $2, $3
          where not exists (
            select 1 from drizzle.__drizzle_migrations where name = $3
          )
        `,
        [hash, migrationTimestamp(name), name],
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
