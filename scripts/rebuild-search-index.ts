import 'dotenv/config';
import { Client } from '@elastic/elasticsearch';
import { pool } from '../src/db/db';
import {
  programDocuments,
  exerciseDocuments,
} from '../src/catalog-search/catalog-documents';
import {
  programIndexDefinition,
  exerciseIndexDefinition,
} from '../src/catalog-search/index-definitions';
import {
  EXERCISES_READ_ALIAS,
  EXERCISES_WRITE_ALIAS,
  PROGRAMS_READ_ALIAS,
  PROGRAMS_WRITE_ALIAS,
} from '../src/catalog-search/catalog-search.constants';
import { IndexWriterService } from '../src/search-indexer/index-writer.service';
import type { EventEnvelope } from '../packages/event-contracts/events';

type Watermark = { occurredAt: Date; id: string };

const node = process.env.SEARCH_URL;
if (!node) throw new Error('SEARCH_URL is required');
const client = new Client({
  node,
  auth: {
    username: process.env.SEARCH_WRITER_USERNAME ?? '',
    password: process.env.SEARCH_WRITER_PASSWORD ?? '',
  },
  requestTimeout: 30_000,
  enableMetaHeader: false,
});

const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '');
const programsIndex = `hit-programs-v1-${suffix}`;
const exercisesIndex = `hit-exercises-v1-${suffix}`;

async function bulk(
  index: string,
  documents: Array<Record<string, unknown> & { id: number }>,
) {
  for (let offset = 0; offset < documents.length; offset += 500) {
    const slice = documents.slice(offset, offset + 500);
    const result = await client.bulk({
      refresh: false,
      operations: slice.flatMap((document) => [
        { index: { _index: index, _id: String(document.id) } },
        document,
      ]),
    });
    if (result.errors) throw new Error(`bulk indexing failed for ${index}`);
  }
}

async function snapshot() {
  const connection = await pool.connect();
  try {
    await connection.query('begin isolation level repeatable read read only');
    const watermark = await connection.query<Watermark>(
      `select occurred_at as "occurredAt", id
         from outbox_events
        where event_type like 'catalog.%' or event_type = 'user.deleted'
        order by occurred_at desc, id desc limit 1`,
    );
    const [programs, exercises] = await Promise.all([
      programDocuments(connection),
      exerciseDocuments(connection),
    ]);
    await connection.query('commit');
    return { watermark: watermark.rows[0], programs, exercises };
  } catch (error) {
    await connection.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function replay(
  writer: IndexWriterService,
  after?: Watermark,
): Promise<Watermark | undefined> {
  let cursor = after;
  for (;;) {
    const result = await pool.query<{
      id: string;
      eventType: EventEnvelope['type'];
      eventVersion: number;
      occurredAt: Date;
      aggregateType: string;
      aggregateId: string;
      payload: EventEnvelope['payload'];
    }>(
      `select id, event_type as "eventType", event_version as "eventVersion",
              occurred_at as "occurredAt", aggregate_type as "aggregateType",
              aggregate_id as "aggregateId", payload
         from outbox_events
        where (event_type like 'catalog.%' or event_type = 'user.deleted')
          and ($1::timestamptz is null or (occurred_at, id) > ($1::timestamptz, $2::uuid))
        order by occurred_at, id limit 500`,
      [cursor?.occurredAt ?? null, cursor?.id ?? null],
    );
    for (const row of result.rows) {
      await writer.apply(
        {
          id: row.id,
          type: row.eventType,
          version: row.eventVersion,
          occurredAt: row.occurredAt.toISOString(),
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          payload: row.payload,
        },
        { programs: programsIndex, exercises: exercisesIndex },
      );
      cursor = { occurredAt: row.occurredAt, id: row.id };
    }
    if (result.rows.length < 500) return cursor;
  }
}

async function currentAliasIndices(alias: string): Promise<string[]> {
  try {
    return Object.keys(await client.indices.getAlias({ name: alias }));
  } catch (error) {
    if ((error as { meta?: { statusCode?: number } }).meta?.statusCode === 404)
      return [];
    throw error;
  }
}

async function swapAliases() {
  const [programs, exercises] = await Promise.all([
    currentAliasIndices(PROGRAMS_READ_ALIAS),
    currentAliasIndices(EXERCISES_READ_ALIAS),
  ]);
  await client.indices.updateAliases({
    actions: [
      ...programs.flatMap((index) => [
        { remove: { index, alias: PROGRAMS_READ_ALIAS } },
        { remove: { index, alias: PROGRAMS_WRITE_ALIAS } },
      ]),
      ...exercises.flatMap((index) => [
        { remove: { index, alias: EXERCISES_READ_ALIAS } },
        { remove: { index, alias: EXERCISES_WRITE_ALIAS } },
      ]),
      { add: { index: programsIndex, alias: PROGRAMS_READ_ALIAS } },
      {
        add: {
          index: programsIndex,
          alias: PROGRAMS_WRITE_ALIAS,
          is_write_index: true,
        },
      },
      { add: { index: exercisesIndex, alias: EXERCISES_READ_ALIAS } },
      {
        add: {
          index: exercisesIndex,
          alias: EXERCISES_WRITE_ALIAS,
          is_write_index: true,
        },
      },
    ],
  });
}

async function main() {
  const data = await snapshot();
  await Promise.all([
    client.indices.create({ index: programsIndex, ...programIndexDefinition }),
    client.indices.create({
      index: exercisesIndex,
      ...exerciseIndexDefinition,
    }),
  ]);
  const at =
    data.watermark?.occurredAt.toISOString() ?? '1970-01-01T00:00:00.000Z';
  const eventId = data.watermark?.id ?? '00000000-0000-0000-0000-000000000000';
  await Promise.all([
    bulk(
      programsIndex,
      data.programs.map((document) => ({
        ...document,
        lastEventAt: at,
        lastEventId: eventId,
      })),
    ),
    bulk(
      exercisesIndex,
      data.exercises.map((document) => ({
        ...document,
        lastEventAt: at,
        lastEventId: eventId,
      })),
    ),
  ]);
  const writer = new IndexWriterService(client);
  const replayed = await replay(writer, data.watermark);
  await Promise.all([
    client.indices.refresh({ index: programsIndex }),
    client.indices.refresh({ index: exercisesIndex }),
  ]);
  await swapAliases();
  await replay(writer, replayed);
  const [programCount, exerciseCount] = await Promise.all([
    client.count({ index: programsIndex, query: { term: { deleted: false } } }),
    client.count({
      index: exercisesIndex,
      query: { term: { deleted: false } },
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify({ programsIndex, exercisesIndex, programs: programCount.count, exercises: exerciseCount.count })}\n`,
  );
}

main()
  .finally(() => Promise.all([client.close(), pool.end()]))
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
