import { randomUUID } from 'node:crypto';
import type { KnownEnvelope } from '../../events/event-validator';

let nextSetId = 1;

export type SetSpec = { exerciseId: number; weight: number; reps: number };

export function workoutFinished(options: {
  workoutId: number;
  userId?: number;
  finishedAt: string;
  durationSeconds?: number;
  sets: SetSpec[];
  id?: string;
}): KnownEnvelope {
  const userId = options.userId ?? 7;
  const sets = options.sets.map((set) => ({
    setId: nextSetId++,
    exerciseId: set.exerciseId,
    weight: set.weight,
    reps: set.reps,
    rpe: null,
    isFailure: false,
    isDropSet: false,
    volume: set.weight * set.reps,
  }));
  const finished = new Date(options.finishedAt);
  const duration = options.durationSeconds ?? 1800;
  return {
    id: options.id ?? randomUUID(),
    type: 'workout.finished',
    version: 1,
    occurredAt: options.finishedAt,
    aggregateType: 'workout',
    aggregateId: String(options.workoutId),
    payload: {
      workoutId: options.workoutId,
      userId,
      programId: null,
      scheduleId: null,
      startedAt: new Date(finished.getTime() - duration * 1000).toISOString(),
      finishedAt: finished.toISOString(),
      durationSeconds: duration,
      pausedSeconds: 0,
      setCount: sets.length,
      exerciseIds: [...new Set(sets.map((s) => s.exerciseId))],
      totalVolume: sets.reduce((sum, s) => sum + s.volume, 0),
      sets,
    },
  };
}

export function bodyMetricRecorded(options: {
  metricId: number;
  userId?: number;
  recordedAt: string;
  weight?: number | null;
}): KnownEnvelope {
  const userId = options.userId ?? 7;
  return {
    id: randomUUID(),
    type: 'body_metric.recorded',
    version: 1,
    occurredAt: options.recordedAt,
    aggregateType: 'user',
    aggregateId: String(userId),
    payload: {
      metricId: options.metricId,
      userId,
      weight: options.weight ?? 80,
      bodyFatPercentage: 15,
      muscleMass: null,
      waistCircumference: null,
      recordedAt: options.recordedAt,
      source: 'body_metrics',
    },
  };
}

export function userDeleted(userId: number, deletedAt: string): KnownEnvelope {
  return {
    id: randomUUID(),
    type: 'user.deleted',
    version: 1,
    occurredAt: deletedAt,
    aggregateType: 'user',
    aggregateId: String(userId),
    payload: { userId, deletedByUserId: 1, deletedAt },
  };
}

export const source = (offset = '0') => ({
  topic: 'hit.workout.v1',
  partition: 0,
  offset,
});
