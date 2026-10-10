import { Inject, Injectable, Logger } from '@nestjs/common';
import type { KnownEnvelope } from '../events/event-validator';
import {
  addDays,
  aggregateWeek,
  computeDayProgress,
  computePersonalRecord,
  computeStreak,
  isoWeekStart,
  totalsOf,
  utcDate,
  type PersonalRecord,
} from './calculations';
import {
  READ_MODEL_STORE,
  type EventSource,
  type ReadModelStore,
  type ReadModelTx,
} from './read-model-store';
import type {
  BodyMetricRecordedV1,
  ProgramScheduledV1,
  ProgramUnscheduledV1,
  UserDeletedV1,
  WorkoutFinishedV1,
} from '../../../../packages/event-contracts/events';

/**
 * - applied: the event changed read models;
 * - duplicate: already processed (same event id, or the same workout/metric
 *   under another id, e.g. a backfilled copy);
 * - ignored: a valid event this service has no read model for;
 * - erased_user: the user was already erased (`user.deleted` came first).
 */
export type ApplyResult = 'applied' | 'duplicate' | 'ignored' | 'erased_user';

/** A payload that passed the JSON Schema but is semantically unusable. */
export class InvalidEventError extends Error {}

function parseInstant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new InvalidEventError(`${field} is not a valid timestamp`);
  return parsed;
}

@Injectable()
export class Projector {
  private readonly logger = new Logger(Projector.name);

  constructor(
    @Inject(READ_MODEL_STORE) private readonly store: ReadModelStore,
  ) {}

  /**
   * Applies one validated event in ONE database transaction: the
   * `processed_events` insert and the projection commit or roll back
   * together, so a redelivered event is either fully applied once or not at
   * all ("exactly-once effect" on top of at-least-once delivery).
   */
  apply(envelope: KnownEnvelope, source: EventSource): Promise<ApplyResult> {
    return this.store.transaction(async (tx) => {
      if (!(await tx.markProcessed(envelope, source))) return 'duplicate';
      if (
        envelope.type === 'catalog.program.changed' ||
        envelope.type === 'catalog.exercise.changed'
      )
        return 'ignored';
      await tx.lockUser(envelope.payload.userId);
      switch (envelope.type) {
        case 'workout.finished':
          return this.workoutFinished(tx, envelope.id, envelope.payload);
        case 'body_metric.recorded':
          return this.bodyMetricRecorded(tx, envelope.payload);
        case 'user.deleted':
          return this.userDeleted(tx, envelope.payload);
        // No read model needs these yet. `workout.cancelled` can never
        // follow `workout.finished` (the API refuses it), so ignoring it is safe.
        case 'workout.started':
        case 'workout.cancelled':
          return 'ignored';
        case 'program.scheduled':
          return this.programScheduled(tx, envelope.payload);
        case 'program.unscheduled':
          return this.programUnscheduled(tx, envelope.payload);
        case 'user.registered':
          return 'ignored';
        default: {
          const exhaustive: never = envelope;
          throw new InvalidEventError(
            `unhandled event ${(exhaustive as { type: string }).type}`,
          );
        }
      }
    });
  }

  private async workoutFinished(
    tx: ReadModelTx,
    eventId: string,
    payload: WorkoutFinishedV1,
  ): Promise<ApplyResult> {
    const { userId } = payload;
    if (await tx.isErased(userId)) return 'erased_user';
    const finishedAt = parseInstant(payload.finishedAt, 'finishedAt');
    const totals = totalsOf(payload.sets);
    const inserted = await tx.insertFinishedWorkout({
      workoutId: payload.workoutId,
      userId,
      eventId,
      scheduleId: payload.scheduleId,
      scheduledFor: payload.scheduledFor ?? null,
      startedAt: parseInstant(payload.startedAt, 'startedAt'),
      finishedAt,
      durationSeconds: Math.max(0, Math.round(payload.durationSeconds)),
      ...totals,
      payload,
      sets: payload.sets.map((set) => ({
        setId: set.setId,
        exerciseId: set.exerciseId,
        weightKg: set.weight,
        reps: set.reps,
      })),
    });
    if (!inserted) return 'duplicate';

    // Recompute (never increment) every aggregate this workout touches from
    // the stored facts: the result does not depend on arrival order.
    const week = isoWeekStart(finishedAt);
    const weekFrom = new Date(`${week}T00:00:00Z`);
    const weekTo = new Date(`${addDays(week, 7)}T00:00:00Z`);
    await tx.saveWeek(
      userId,
      week,
      aggregateWeek(await tx.workoutTotalsBetween(userId, weekFrom, weekTo)),
    );

    const streak = computeStreak(await tx.workoutDates(userId));
    if (streak) await tx.saveStreak(userId, streak);

    const exerciseIds = [...new Set(payload.sets.map((s) => s.exerciseId))];
    if (exerciseIds.length) {
      const sets = await tx.setsFor(userId, exerciseIds);
      const records: PersonalRecord[] = [];
      const day = utcDate(finishedAt);
      for (const exerciseId of exerciseIds) {
        const ofExercise = sets.filter((s) => s.exerciseId === exerciseId);
        const record = computePersonalRecord(exerciseId, ofExercise);
        if (record) records.push(record);
        const progress = computeDayProgress(
          ofExercise.filter((s) => utcDate(s.finishedAt) === day),
        );
        if (progress)
          await tx.saveExerciseProgress(userId, exerciseId, day, progress);
      }
      await tx.savePersonalRecords(userId, records);
    }
    return 'applied';
  }

  private async programScheduled(
    tx: ReadModelTx,
    payload: ProgramScheduledV1,
  ): Promise<ApplyResult> {
    if (await tx.isErased(payload.userId)) return 'erased_user';
    const assignments =
      payload.assignments ??
      (payload.scheduleIds.length === 1
        ? [
            {
              scheduleId: payload.scheduleIds[0],
              scheduledFor: payload.scheduledFor,
            },
          ]
        : []);
    if (!assignments.length) return 'ignored';
    const inserted = await tx.insertScheduledAssignments(
      assignments.map((assignment) => ({
        ...assignment,
        userId: payload.userId,
        programId: payload.programId,
      })),
    );
    return inserted ? 'applied' : 'duplicate';
  }

  private async programUnscheduled(
    tx: ReadModelTx,
    payload: ProgramUnscheduledV1,
  ): Promise<ApplyResult> {
    if (await tx.isErased(payload.userId)) return 'erased_user';
    if (!payload.scheduleIds.length) return 'ignored';
    const deleted = await tx.deleteScheduledAssignments(
      payload.userId,
      payload.scheduleIds,
    );
    return deleted ? 'applied' : 'duplicate';
  }

  private async bodyMetricRecorded(
    tx: ReadModelTx,
    payload: BodyMetricRecordedV1,
  ): Promise<ApplyResult> {
    if (await tx.isErased(payload.userId)) return 'erased_user';
    const inserted = await tx.insertBodyMetric({
      metricId: payload.metricId,
      userId: payload.userId,
      recordedAt: parseInstant(payload.recordedAt, 'recordedAt'),
      weight: payload.weight,
      bodyFatPercentage: payload.bodyFatPercentage,
      muscleMass: payload.muscleMass,
      waistCircumference: payload.waistCircumference,
    });
    return inserted ? 'applied' : 'duplicate';
  }

  private async userDeleted(
    tx: ReadModelTx,
    payload: UserDeletedV1,
  ): Promise<ApplyResult> {
    await tx.eraseUser(
      payload.userId,
      parseInstant(payload.deletedAt, 'deletedAt'),
    );
    // Logged clearly (ids only): the future account-deletion saga relies on
    // this erasure having happened.
    this.logger.warn({
      msg: 'analytics data erased for deleted user',
      erasure: 'user.deleted',
      userId: payload.userId,
    });
    return 'applied';
  }
}
