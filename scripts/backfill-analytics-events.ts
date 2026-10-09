/**
 * One-off, manually run backfill of analytics history that predates the
 * transactional outbox (see docs/diploma/analytics-cqrs.md):
 *
 *   DATABASE_URL=... npx tsx scripts/backfill-analytics-events.ts [--dry-run]
 *
 * Enqueues `workout.finished` for every completed workout and
 * `body_metric.recorded` for every body-metric row that has no live outbox
 * event yet. Event ids are deterministic (uuid v5 of `<type>:<id>`), inserts
 * are ON CONFLICT (id) DO NOTHING, and the analytics consumer dedups by
 * event id and by workout/metric id, so re-running it is harmless. The relay
 * then publishes the rows like any other outbox event.
 */
import { Client } from 'pg';
import {
  bodyMetricRow,
  workoutFinishedRow,
  programScheduledRow,
  type HistoricalWorkout,
  type OutboxRow,
} from './backfill-analytics-events.logic';

const BATCH = 200;
// `timestamp without time zone` columns hold UTC wall-clock time (drizzle
// writes Date#toISOString()); format them as ISO strings in SQL so the
// host's local time zone can never shift them.
const iso = (column: string) =>
  `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

async function insertRows(client: Client, rows: OutboxRow[], dryRun: boolean) {
  if (!rows.length || dryRun) return rows.length;
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(
      `insert into outbox_events
         (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [
        row.id,
        row.aggregateType,
        row.aggregateId,
        row.eventType,
        row.eventVersion,
        JSON.stringify(row.payload),
        row.occurredAt,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function backfillWorkouts(client: Client, dryRun: boolean) {
  let cursor = 0;
  let candidates = 0;
  let inserted = 0;
  for (;;) {
    const workouts = await client.query<{
      id: number;
      user_id: number;
      program_id: number | null;
      schedule_id: number | null;
      scheduled_for: string | null;
      started_at: string;
      finished_at: string;
      duration_seconds: number | null;
    }>(
      `select w.id, w.user_id, (w.history_snapshot->>'programId')::int as program_id,
              w.schedule_id, ups.scheduled_for,
              ${iso('w.created_at')} as started_at,
              ${iso('w.finished_at')} as finished_at, w.duration_seconds
         from workouts w left join user_program_schedule ups on ups.id = w.schedule_id
        where w.id > $1 and w.status = 'completed' and w.finished_at is not null
        order by w.id
        limit ${BATCH}`,
      [cursor],
    );
    if (!workouts.rows.length) break;
    const ids = workouts.rows.map((w) => w.id);
    const sets = await client.query<{
      id: number;
      workout_id: number;
      exercise_id: number;
      weight: number;
      reps: number;
      rpe: number | null;
      is_failure: boolean;
      is_drop_set: boolean;
      exercise_name: string | null;
      muscle_id: number | null;
      muscle_common_name: string | null;
    }>(
      `select s.id, s.workout_id, s.exercise_id, s.weight, s.reps, s.rpe, s.is_failure, s.is_drop_set,
              e.name as exercise_name, m.id as muscle_id, m.common_name as muscle_common_name
         from sets s left join exercises e on e.id = s.exercise_id
         left join exercises_train_muscles etm on etm.exercise_id = s.exercise_id
         left join muscles m on m.id = etm.muscle_id
        where s.workout_id = any($1::int[]) order by s.id`,
      [ids],
    );
    const rows = workouts.rows.map((w) =>
      workoutFinishedRow({
        id: w.id,
        userId: w.user_id,
        programId: w.program_id,
        scheduleId: w.schedule_id,
        scheduledFor: w.scheduled_for,
        startedAt: w.started_at,
        finishedAt: w.finished_at,
        durationSeconds: w.duration_seconds,
        sets: [...new Map(sets.rows.filter((s) => s.workout_id === w.id).map((s) => [s.id, s])).values()]
          .map((s) => ({
            id: s.id,
            exerciseId: s.exercise_id,
            weight: s.weight,
            reps: s.reps,
            rpe: s.rpe,
            isFailure: s.is_failure,
            isDropSet: s.is_drop_set,
            exerciseName: s.exercise_name,
            muscleGroups: sets.rows.filter((m) => m.id === s.id && m.muscle_id !== null).map((m) => ({ id: m.muscle_id!, commonName: m.muscle_common_name! })),
          })) satisfies HistoricalWorkout['sets'],
      }),
    );
    candidates += rows.length;
    inserted += await insertRows(client, rows, dryRun);
    cursor = ids[ids.length - 1];
  }
  return { candidates, inserted };
}

async function backfillSchedules(client: Client, dryRun: boolean) {
  const result = await client.query<{ user_id: number; program_id: number; id: number; scheduled_for: string }>(`select s.user_id, s.program_id, s.id, s.scheduled_for from user_program_schedule s order by s.id`);
  // The deterministic id is checked per row to keep this query portable across existing schemas.
  let inserted = 0;
  for (const row of result.rows) {
    inserted += await insertRows(client, [programScheduledRow({ userId: row.user_id, programId: row.program_id, scheduleId: row.id, scheduledFor: row.scheduled_for })], dryRun);
  }
  return { candidates: result.rows.length, inserted };
}

async function backfillBodyMetrics(client: Client, dryRun: boolean) {
  let cursor = 0;
  let candidates = 0;
  let inserted = 0;
  for (;;) {
    const metrics = await client.query<{
      id: number;
      user_id: number;
      weight: number | null;
      body_fat_percentage: number | null;
      muscle_mass: number | null;
      waist_circumference: number | null;
      recorded_at: string;
    }>(
      `select m.id, m.user_id, m.weight, m.body_fat_percentage, m.muscle_mass,
              m.waist_circumference, ${iso('m.recorded_at')} as recorded_at
         from user_body_metrics m
        where m.id > $1
          and not exists (
            select 1 from outbox_events o
             where o.event_type = 'body_metric.recorded'
               and o.aggregate_id = m.user_id::text
               and o.payload->>'metricId' = m.id::text)
        order by m.id
        limit ${BATCH}`,
      [cursor],
    );
    if (!metrics.rows.length) break;
    const rows = metrics.rows.map((m) =>
      bodyMetricRow({
        id: m.id,
        userId: m.user_id,
        weight: m.weight,
        bodyFatPercentage: m.body_fat_percentage,
        muscleMass: m.muscle_mass,
        waistCircumference: m.waist_circumference,
        recordedAt: m.recorded_at,
      }),
    );
    candidates += rows.length;
    inserted += await insertRows(client, rows, dryRun);
    cursor = metrics.rows[metrics.rows.length - 1].id;
  }
  return { candidates, inserted };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const dryRun = process.argv.includes('--dry-run');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const workouts = await backfillWorkouts(client, dryRun);
    const bodyMetrics = await backfillBodyMetrics(client, dryRun);
    const schedules = await backfillSchedules(client, dryRun);
    console.log(
      JSON.stringify({
        msg: 'analytics backfill',
        dryRun,
        workouts,
        bodyMetrics,
        schedules,
      }),
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      msg: 'analytics backfill failed',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
