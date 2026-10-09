import {
  bigint,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Analytics read side (CQRS). This schema lives in its own `analytics`
 * database and never references the main API's tables: user/exercise/workout
 * ids are plain integers copied from events, not foreign keys.
 *
 * Two kinds of tables:
 * - bookkeeping/facts (`processed_events`, `finished_workouts`,
 *   `finished_sets`, `erased_users`) - what the consumer has seen;
 * - read models (`weekly_volume`, `personal_records`, `training_streaks`,
 *   `exercise_progress`, `body_metrics_timeline`) - recomputed from the facts
 *   inside the same transaction, so late or out-of-order events cannot
 *   corrupt an aggregate.
 */

/** Idempotency ledger: one row per envelope id ever applied. */
export const processedEvents = pgTable('processed_events', {
  eventId: uuid('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  eventVersion: integer('event_version').notNull(),
  topic: text('topic').notNull(),
  partition: integer('partition').notNull(),
  offset: bigint('offset', { mode: 'string' }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Fact table: one row per finished workout (workout ids are global). */
export const finishedWorkouts = pgTable(
  'finished_workouts',
  {
    workoutId: integer('workout_id').primaryKey(),
    userId: integer('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    scheduleId: integer('schedule_id'),
    scheduledFor: date('scheduled_for'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    setCount: integer('set_count').notNull(),
    reps: integer('reps').notNull(),
    volumeKg: doublePrecision('volume_kg').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('finished_workouts_user_finished_idx').on(
      table.userId,
      table.finishedAt,
    ),
  ],
);

/** Planned calendar assignments, copied from `program.scheduled` events. */
export const scheduledAssignments = pgTable(
  'scheduled_assignments',
  {
    scheduleId: integer('schedule_id').primaryKey(),
    userId: integer('user_id').notNull(),
    programId: integer('program_id').notNull(),
    scheduledFor: date('scheduled_for').notNull(),
  },
  (table) => [
    index('scheduled_assignments_user_date_idx').on(
      table.userId,
      table.scheduledFor,
    ),
  ],
);

/** Fact table: the performed sets of every finished workout. */
export const finishedSets = pgTable(
  'finished_sets',
  {
    setId: integer('set_id').primaryKey(),
    workoutId: integer('workout_id').notNull(),
    userId: integer('user_id').notNull(),
    exerciseId: integer('exercise_id').notNull(),
    weightKg: doublePrecision('weight_kg').notNull(),
    reps: integer('reps').notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('finished_sets_user_exercise_idx').on(
      table.userId,
      table.exerciseId,
      table.finishedAt,
    ),
  ],
);

/**
 * Tombstones for `user.deleted`. Kafka has no ordering across topics, so a
 * `workout.finished` (hit.workout.v1) may arrive after the `user.deleted`
 * (hit.user.v1) of the same user; the tombstone makes the consumer drop it
 * instead of resurrecting erased data. User ids are never reused.
 */
export const erasedUsers = pgTable('erased_users', {
  userId: integer('user_id').primaryKey(),
  erasedAt: timestamp('erased_at', { withTimezone: true }).notNull(),
});

export const weeklyVolume = pgTable(
  'weekly_volume',
  {
    userId: integer('user_id').notNull(),
    isoWeekStart: date('iso_week_start', { mode: 'string' }).notNull(),
    workouts: integer('workouts').notNull(),
    sets: integer('sets').notNull(),
    reps: integer('reps').notNull(),
    volumeKg: doublePrecision('volume_kg').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.isoWeekStart] })],
);

export const personalRecords = pgTable(
  'personal_records',
  {
    userId: integer('user_id').notNull(),
    exerciseId: integer('exercise_id').notNull(),
    bestWeightKg: doublePrecision('best_weight_kg').notNull(),
    bestRepsAtWeight: integer('best_reps_at_weight').notNull(),
    /** When/where the heaviest set (best_weight_kg x best_reps_at_weight) was first done. */
    achievedAt: timestamp('achieved_at', { withTimezone: true }).notNull(),
    workoutId: integer('workout_id').notNull(),
    /** Epley: weight * (1 + reps / 30). */
    bestE1rmKg: doublePrecision('best_e1rm_kg').notNull(),
    bestE1rmAchievedAt: timestamp('best_e1rm_achieved_at', {
      withTimezone: true,
    }).notNull(),
    bestE1rmWorkoutId: integer('best_e1rm_workout_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.exerciseId] })],
);

export const trainingStreaks = pgTable('training_streaks', {
  userId: integer('user_id').primaryKey(),
  /** Length of the run of consecutive UTC days ending at last_workout_date. */
  currentStreakDays: integer('current_streak_days').notNull(),
  longestStreakDays: integer('longest_streak_days').notNull(),
  lastWorkoutDate: date('last_workout_date', { mode: 'string' }).notNull(),
});

export const exerciseProgress = pgTable(
  'exercise_progress',
  {
    userId: integer('user_id').notNull(),
    exerciseId: integer('exercise_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    topSetWeightKg: doublePrecision('top_set_weight_kg').notNull(),
    topSetReps: integer('top_set_reps').notNull(),
    e1rmKg: doublePrecision('e1rm_kg').notNull(),
    volumeKg: doublePrecision('volume_kg').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.exerciseId, table.date] }),
  ],
);

export const bodyMetricsTimeline = pgTable(
  'body_metrics_timeline',
  {
    metricId: integer('metric_id').primaryKey(),
    userId: integer('user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    weight: doublePrecision('weight'),
    bodyFatPercentage: doublePrecision('body_fat_percentage'),
    muscleMass: doublePrecision('muscle_mass'),
    waistCircumference: doublePrecision('waist_circumference'),
  },
  (table) => [
    index('body_metrics_timeline_user_recorded_idx').on(
      table.userId,
      table.recordedAt,
    ),
  ],
);

/** Every read-model and bookkeeping table, in the order a rebuild truncates them. */
export const allAnalyticsTables = [
  'processed_events',
  'finished_workouts',
  'finished_sets',
  'scheduled_assignments',
  'erased_users',
  'weekly_volume',
  'personal_records',
  'training_streaks',
  'exercise_progress',
  'body_metrics_timeline',
] as const;
