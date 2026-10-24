// EN: Implements atomic, idempotent PostgreSQL writes for CQRS read models, processed events, checkpoints, and rebuild state.
// UK: Реалізує атомарні й ідемпотентні записи PostgreSQL для CQRS-моделей читання, оброблених подій, контрольних точок і стану перебудови.

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { ANALYTICS_DB, type AnalyticsDb } from '../db/database';
import {
  bodyMetricsTimeline,
  erasedUsers,
  exerciseProgress,
  finishedSets,
  finishedWorkouts,
  personalRecords,
  processedEvents,
  scheduledAssignments,
  trainingStreaks,
  weeklyVolume,
} from '../db/schema';
import type {
  DayProgress,
  PersonalRecord,
  Streak,
  WeekAggregate,
} from './calculations';
import type {
  BodyMetricFact,
  EventSource,
  FinishedWorkoutFact,
  ReadModelStore,
  ReadModelTx,
} from './read-model-store';

type Tx = Parameters<Parameters<AnalyticsDb['transaction']>[0]>[0];

class PgReadModelTx implements ReadModelTx {
  constructor(private readonly tx: Tx) {}

  async markProcessed(
    event: { id: string; type: string; version: number },
    source: EventSource,
  ) {
    // EN: The unique event ID is claimed inside the projection transaction, turning Kafka's at-least-once delivery into an exactly-once database effect.
    // UK: Унікальний ID події захоплюється всередині транзакції проєкції, перетворюючи доставку Kafka at-least-once на exactly-once ефект у базі даних.
    const rows = await this.tx
      .insert(processedEvents)
      .values({
        eventId: event.id,
        eventType: event.type,
        eventVersion: event.version,
        topic: source.topic,
        partition: source.partition,
        offset: source.offset,
      })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId });
    return rows.length > 0;
  }

  async lockUser(userId: number) {
    // Namespace 7401 keeps these keys apart from any other advisory lock.
    // EN: Per-user serialization prevents events from different Kafka topics from racing while aggregate rows are recomputed.
    // UK: Послідовна обробка для кожного користувача не дозволяє подіям із різних тем Kafka конкурувати під час повторного обчислення агрегатів.
    await this.tx.execute(sql`select pg_advisory_xact_lock(7401, ${userId})`);
  }

  async isErased(userId: number) {
    const rows = await this.tx
      .select({ userId: erasedUsers.userId })
      .from(erasedUsers)
      .where(eq(erasedUsers.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  async insertFinishedWorkout(fact: FinishedWorkoutFact) {
    const rows = await this.tx
      .insert(finishedWorkouts)
      .values({
        workoutId: fact.workoutId,
        userId: fact.userId,
        eventId: fact.eventId,
        scheduleId: fact.scheduleId,
        scheduledFor: fact.scheduledFor,
        startedAt: fact.startedAt,
        finishedAt: fact.finishedAt,
        durationSeconds: fact.durationSeconds,
        setCount: fact.setCount,
        reps: fact.reps,
        volumeKg: fact.volumeKg,
        payload: fact.payload,
      })
      .onConflictDoUpdate({
        target: finishedWorkouts.workoutId,
        set: {
          eventId: fact.eventId,
          scheduleId: fact.scheduleId,
          scheduledFor: fact.scheduledFor,
          startedAt: fact.startedAt,
          finishedAt: fact.finishedAt,
          durationSeconds: fact.durationSeconds,
          setCount: fact.setCount,
          reps: fact.reps,
          volumeKg: fact.volumeKg,
          payload: fact.payload,
        },
        setWhere: sql`${finishedWorkouts.payload} is distinct from excluded.payload`,
      })
      .returning({ workoutId: finishedWorkouts.workoutId });
    if (!rows.length) return false;
    if (fact.sets.length)
      await this.tx
        .insert(finishedSets)
        .values(
          fact.sets.map((set) => ({
            ...set,
            workoutId: fact.workoutId,
            userId: fact.userId,
            finishedAt: fact.finishedAt,
          })),
        )
        .onConflictDoNothing();
    return true;
  }

  // EN: Read affected exercises before removing the workout and its sets in this projection transaction.
  // UK: Зчитуємо зачеплені вправи перед видаленням тренування та його сетів у транзакції проєкції.
  async deleteFinishedWorkout(workoutId: number, userId: number) {
    const [workout] = await this.tx
      .select({ finishedAt: finishedWorkouts.finishedAt })
      .from(finishedWorkouts)
      .where(
        and(
          eq(finishedWorkouts.workoutId, workoutId),
          eq(finishedWorkouts.userId, userId),
        ),
      )
      .limit(1);
    if (!workout) return null;
    const sets = await this.tx
      .selectDistinct({ exerciseId: finishedSets.exerciseId })
      .from(finishedSets)
      .where(
        and(
          eq(finishedSets.workoutId, workoutId),
          eq(finishedSets.userId, userId),
        ),
      );
    await this.tx
      .delete(finishedSets)
      .where(
        and(
          eq(finishedSets.workoutId, workoutId),
          eq(finishedSets.userId, userId),
        ),
      );
    await this.tx
      .delete(finishedWorkouts)
      .where(
        and(
          eq(finishedWorkouts.workoutId, workoutId),
          eq(finishedWorkouts.userId, userId),
        ),
      );
    return {
      finishedAt: workout.finishedAt,
      exerciseIds: sets.map((set) => set.exerciseId),
    };
  }

  async insertScheduledAssignments(
    facts: readonly import('./read-model-store').ScheduledAssignmentFact[],
  ) {
    if (!facts.length) return 0;
    const rows = await this.tx
      .insert(scheduledAssignments)
      .values([...facts])
      .onConflictDoNothing()
      .returning({ scheduleId: scheduledAssignments.scheduleId });
    return rows.length;
  }

  async deleteScheduledAssignments(
    userId: number,
    scheduleIds: readonly number[],
  ) {
    if (!scheduleIds.length) return 0;
    const rows = await this.tx
      .delete(scheduledAssignments)
      .where(
        and(
          eq(scheduledAssignments.userId, userId),
          inArray(scheduledAssignments.scheduleId, [...scheduleIds]),
        ),
      )
      .returning({ scheduleId: scheduledAssignments.scheduleId });
    return rows.length;
  }

  workoutTotalsBetween(userId: number, fromInclusive: Date, toExclusive: Date) {
    return this.tx
      .select({
        setCount: finishedWorkouts.setCount,
        reps: finishedWorkouts.reps,
        volumeKg: finishedWorkouts.volumeKg,
        durationSeconds: finishedWorkouts.durationSeconds,
      })
      .from(finishedWorkouts)
      .where(
        and(
          eq(finishedWorkouts.userId, userId),
          gte(finishedWorkouts.finishedAt, fromInclusive),
          lt(finishedWorkouts.finishedAt, toExclusive),
        ),
      );
  }

  async saveWeek(userId: number, isoWeekStart: string, week: WeekAggregate) {
    if (!week.workouts) {
      await this.tx
        .delete(weeklyVolume)
        .where(
          and(
            eq(weeklyVolume.userId, userId),
            eq(weeklyVolume.isoWeekStart, isoWeekStart),
          ),
        );
      return;
    }
    await this.tx
      .insert(weeklyVolume)
      .values({ userId, isoWeekStart, ...week })
      .onConflictDoUpdate({
        target: [weeklyVolume.userId, weeklyVolume.isoWeekStart],
        set: week,
      });
  }

  async workoutDates(userId: number) {
    const rows = await this.tx
      .selectDistinct({
        date: sql<string>`to_char(${finishedWorkouts.finishedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      })
      .from(finishedWorkouts)
      .where(eq(finishedWorkouts.userId, userId));
    return rows.map((row) => row.date);
  }

  async saveStreak(userId: number, streak: Streak | null) {
    if (!streak) {
      await this.tx
        .delete(trainingStreaks)
        .where(eq(trainingStreaks.userId, userId));
      return;
    }
    await this.tx
      .insert(trainingStreaks)
      .values({ userId, ...streak })
      .onConflictDoUpdate({ target: trainingStreaks.userId, set: streak });
  }

  setsFor(userId: number, exerciseIds: readonly number[]) {
    return this.tx
      .select({
        workoutId: finishedSets.workoutId,
        exerciseId: finishedSets.exerciseId,
        weightKg: finishedSets.weightKg,
        reps: finishedSets.reps,
        durationSeconds: finishedSets.durationSeconds,
        finishedAt: finishedSets.finishedAt,
      })
      .from(finishedSets)
      .where(
        and(
          eq(finishedSets.userId, userId),
          inArray(finishedSets.exerciseId, [...exerciseIds]),
        ),
      );
  }

  async savePersonalRecords(
    userId: number,
    records: readonly PersonalRecord[],
  ) {
    if (!records.length) return;
    await this.tx
      .insert(personalRecords)
      .values(records.map((record) => ({ userId, ...record })))
      .onConflictDoUpdate({
        target: [personalRecords.userId, personalRecords.exerciseId],
        set: {
          bestWeightKg: sql`excluded.best_weight_kg`,
          bestRepsAtWeight: sql`excluded.best_reps_at_weight`,
          achievedAt: sql`excluded.achieved_at`,
          workoutId: sql`excluded.workout_id`,
          bestE1rmKg: sql`excluded.best_e1rm_kg`,
          bestE1rmAchievedAt: sql`excluded.best_e1rm_achieved_at`,
          bestE1rmWorkoutId: sql`excluded.best_e1rm_workout_id`,
          updatedAt: sql`now()`,
        },
        // "Updated only when beaten": an unchanged record keeps its row
        // (and its updated_at) untouched.
        setWhere: sql`(${personalRecords.bestWeightKg}, ${personalRecords.bestRepsAtWeight}, ${personalRecords.achievedAt}, ${personalRecords.workoutId}, ${personalRecords.bestE1rmKg}, ${personalRecords.bestE1rmAchievedAt}, ${personalRecords.bestE1rmWorkoutId})
          is distinct from (excluded.best_weight_kg, excluded.best_reps_at_weight, excluded.achieved_at, excluded.workout_id, excluded.best_e1rm_kg, excluded.best_e1rm_achieved_at, excluded.best_e1rm_workout_id)`,
      });
  }

  // EN: Remove records with no surviving performed sets.
  // UK: Прибираємо рекорди без жодного збереженого виконаного сету.
  async deletePersonalRecords(userId: number, exerciseIds: readonly number[]) {
    if (!exerciseIds.length) return;
    await this.tx
      .delete(personalRecords)
      .where(
        and(
          eq(personalRecords.userId, userId),
          inArray(personalRecords.exerciseId, [...exerciseIds]),
        ),
      );
  }

  async saveExerciseProgress(
    userId: number,
    exerciseId: number,
    date: string,
    progress: DayProgress | null,
  ) {
    if (!progress) {
      await this.tx
        .delete(exerciseProgress)
        .where(
          and(
            eq(exerciseProgress.userId, userId),
            eq(exerciseProgress.exerciseId, exerciseId),
            eq(exerciseProgress.date, date),
          ),
        );
      return;
    }
    await this.tx
      .insert(exerciseProgress)
      .values({ userId, exerciseId, date, ...progress })
      .onConflictDoUpdate({
        target: [
          exerciseProgress.userId,
          exerciseProgress.exerciseId,
          exerciseProgress.date,
        ],
        set: progress,
      });
  }

  async insertBodyMetric(fact: BodyMetricFact) {
    const rows = await this.tx
      .insert(bodyMetricsTimeline)
      .values(fact)
      .onConflictDoNothing()
      .returning({ metricId: bodyMetricsTimeline.metricId });
    return rows.length > 0;
  }

  async eraseUser(userId: number, erasedAt: Date) {
    // EN: Facts are deleted and an erasure tombstone is written atomically, so a late older event cannot recreate the user's analytics.
    // UK: Факти видаляються, а позначка стирання записується атомарно, тому пізня стара подія не відновить аналітику користувача.
    for (const table of [
      finishedWorkouts,
      finishedSets,
      weeklyVolume,
      personalRecords,
      trainingStreaks,
      exerciseProgress,
      bodyMetricsTimeline,
      scheduledAssignments,
    ])
      await this.tx.delete(table).where(eq(table.userId, userId));
    await this.tx
      .insert(erasedUsers)
      .values({ userId, erasedAt })
      .onConflictDoNothing();
  }
}

@Injectable()
export class PgReadModelStore implements ReadModelStore {
  constructor(@Inject(ANALYTICS_DB) private readonly db: AnalyticsDb) {}

  transaction<T>(work: (tx: ReadModelTx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PgReadModelTx(tx)));
  }
}
