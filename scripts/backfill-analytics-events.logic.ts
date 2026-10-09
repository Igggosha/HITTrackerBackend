import { createHash } from 'node:crypto';
import {
  outboxEventDefinitions,
  performedSetsPayload,
  type BodyMetricRecordedV1,
  type WorkoutFinishedV1,
} from '../packages/event-contracts/events';

/**
 * Fixed namespace for backfilled event ids. Never change it: re-running the
 * backfill must produce the SAME ids so the outbox insert (ON CONFLICT (id)
 * DO NOTHING) and the analytics consumer's processed_events both dedup.
 */
export const BACKFILL_NAMESPACE = '6f1c1d52-4d0e-4b8e-9c61-3c5a9b0e7a11';

/** RFC 4122 version-5 (SHA-1, name-based) UUID. */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function backfillEventId(
  type:
    | 'workout.finished'
    | 'workout.finished.analytics-v2'
    | 'body_metric.recorded'
    | 'program.scheduled',
  key: number,
): string {
  return uuidV5(`${type}:${key}`, BACKFILL_NAMESPACE);
}

export type OutboxRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type HistoricalWorkout = {
  id: number;
  userId: number;
  programId: number | null;
  scheduleId: number | null;
  scheduledFor: string | null;
  /** ISO timestamps (UTC). */
  startedAt: string;
  finishedAt: string;
  durationSeconds: number | null;
  sets: {
    id: number;
    exerciseId: number;
    weight: number;
    reps: number;
    rpe: number | null;
    isFailure: boolean;
    isDropSet: boolean;
    exerciseName?: string | null;
    muscleGroups?: { id: number; commonName: string }[];
  }[];
};

/** Same payload shape as `WorkoutsService.finishWorkout` emits live. */
export function workoutFinishedRow(workout: HistoricalWorkout): OutboxRow {
  const durationSeconds = workout.durationSeconds ?? 0;
  const totalSeconds = Math.max(
    0,
    Math.floor(
      (Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 1000,
    ),
  );
  const payload: WorkoutFinishedV1 = {
    workoutId: workout.id,
    userId: workout.userId,
    programId: workout.programId,
    scheduleId: workout.scheduleId,
    startedAt: workout.startedAt,
    finishedAt: workout.finishedAt,
    durationSeconds,
    pausedSeconds: Math.max(0, totalSeconds - durationSeconds),
    ...performedSetsPayload(workout.sets),
    scheduledFor: workout.scheduledFor,
  };
  return {
    // A distinct deterministic id lets this richer fact update projections
    // created by the original analytics backfill.
    id: backfillEventId('workout.finished.analytics-v2', workout.id),
    aggregateType: outboxEventDefinitions['workout.finished'].aggregateType,
    aggregateId: String(workout.id),
    eventType: 'workout.finished',
    eventVersion: outboxEventDefinitions['workout.finished'].version,
    payload,
    occurredAt: workout.finishedAt,
  };
}

export function programScheduledRow(row: {
  userId: number;
  programId: number;
  scheduleId: number;
  scheduledFor: string;
}): OutboxRow {
  return {
    id: backfillEventId('program.scheduled', row.scheduleId),
    aggregateType: outboxEventDefinitions['program.scheduled'].aggregateType,
    aggregateId: String(row.userId),
    eventType: 'program.scheduled',
    eventVersion: outboxEventDefinitions['program.scheduled'].version,
    payload: {
      userId: row.userId,
      programId: row.programId,
      scheduledFor: row.scheduledFor,
      repeat: 'none',
      repeatUntil: null,
      seriesId: null,
      scheduleIds: [row.scheduleId],
      assignments: [
        { scheduleId: row.scheduleId, scheduledFor: row.scheduledFor },
      ],
    },
    occurredAt: `${row.scheduledFor}T00:00:00.000Z`,
  };
}

export function bodyMetricRow(metric: {
  id: number;
  userId: number;
  weight: number | null;
  bodyFatPercentage: number | null;
  muscleMass: number | null;
  waistCircumference: number | null;
  recordedAt: string;
}): OutboxRow {
  const payload: BodyMetricRecordedV1 = {
    metricId: metric.id,
    userId: metric.userId,
    weight: metric.weight,
    bodyFatPercentage: metric.bodyFatPercentage,
    muscleMass: metric.muscleMass,
    waistCircumference: metric.waistCircumference,
    recordedAt: metric.recordedAt,
    source: 'body_metrics',
  };
  return {
    id: backfillEventId('body_metric.recorded', metric.id),
    aggregateType: outboxEventDefinitions['body_metric.recorded'].aggregateType,
    aggregateId: String(metric.userId),
    eventType: 'body_metric.recorded',
    eventVersion: outboxEventDefinitions['body_metric.recorded'].version,
    payload,
    occurredAt: metric.recordedAt,
  };
}
