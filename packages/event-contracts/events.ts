/**
 * Versioned domain events published through the transactional outbox.
 *
 * Payloads carry ids and the facts an analytics consumer needs. They never
 * carry emails, display names, password/token hashes, or any other credential.
 * A breaking payload change adds a new version (for example
 * `WorkoutFinishedV2`) and bumps `version` in `outboxEventDefinitions`;
 * consumers branch on `event_version`.
 */

export type WorkoutStartedV1 = {
  workoutId: number;
  userId: number;
  type: string;
  programId: number | null;
  scheduleId: number | null;
  plannedExerciseIds: number[];
  startedAt: string;
};

export type PerformedSetV1 = {
  setId: number;
  exerciseId: number;
  weight: number;
  reps: number;
  rpe: number | null;
  isFailure: boolean;
  isDropSet: boolean;
  /** weight * reps */
  volume: number;
};

export type WorkoutFinishedV1 = {
  workoutId: number;
  userId: number;
  programId: number | null;
  scheduleId: number | null;
  startedAt: string;
  finishedAt: string;
  /** Active time, pauses excluded. */
  durationSeconds: number;
  pausedSeconds: number;
  setCount: number;
  exerciseIds: number[];
  /** Sum of weight * reps over all performed sets. */
  totalVolume: number;
  sets: PerformedSetV1[];
};

export type WorkoutCancelledV1 = {
  workoutId: number;
  userId: number;
  startedAt: string;
  cancelledAt: string;
  setCount: number;
};

export type ProgramScheduledV1 = {
  userId: number;
  programId: number;
  scheduledFor: string;
  repeat: 'none' | 'weekly';
  repeatUntil: string | null;
  seriesId: number | null;
  /** Empty when the assignment already existed for that date. */
  scheduleIds: number[];
};

export type BodyMetricRecordedV1 = {
  metricId: number;
  userId: number;
  weight: number | null;
  bodyFatPercentage: number | null;
  muscleMass: number | null;
  waistCircumference: number | null;
  recordedAt: string;
  source: 'body_metrics' | 'profile';
};

export type UserRegisteredV1 = {
  userId: number;
  method: 'email' | 'google';
  registeredAt: string;
};

export type UserDeletedV1 = {
  userId: number;
  deletedByUserId: number;
  deletedAt: string;
};

export type OutboxEventPayloads = {
  'workout.started': WorkoutStartedV1;
  'workout.finished': WorkoutFinishedV1;
  'workout.cancelled': WorkoutCancelledV1;
  'program.scheduled': ProgramScheduledV1;
  'body_metric.recorded': BodyMetricRecordedV1;
  'user.registered': UserRegisteredV1;
  'user.deleted': UserDeletedV1;
};

export type OutboxEventType = keyof OutboxEventPayloads;

export const outboxEventDefinitions: {
  readonly [T in OutboxEventType]: {
    readonly aggregateType: string;
    readonly version: number;
  };
} = {
  'workout.started': { aggregateType: 'workout', version: 1 },
  'workout.finished': { aggregateType: 'workout', version: 1 },
  'workout.cancelled': { aggregateType: 'workout', version: 1 },
  'program.scheduled': { aggregateType: 'user', version: 1 },
  'body_metric.recorded': { aggregateType: 'user', version: 1 },
  'user.registered': { aggregateType: 'user', version: 1 },
  'user.deleted': { aggregateType: 'user', version: 1 },
};

/** The aggregate ID identifies the changed record, not the Kafka key. */
export type OutboxEvent<T extends OutboxEventType = OutboxEventType> = {
  [K in T]: {
    type: K;
    aggregateId: number | string;
    payload: OutboxEventPayloads[K];
  };
}[T];

export type EventEnvelope = {
  id: string;
  type: OutboxEventType;
  version: number;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  payload: OutboxEventPayloads[OutboxEventType];
};

export function topicFor(type: OutboxEventType): string {
  return type.startsWith('workout.') ? 'hit.workout.v1' : 'hit.user.v1';
}

export function eventKey(payload: { userId: number }): string {
  return String(payload.userId);
}

export function envelopeFrom(row: {
  id: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}): EventEnvelope {
  return {
    id: row.id,
    type: row.eventType as OutboxEventType,
    version: row.eventVersion,
    occurredAt: row.occurredAt.toISOString(),
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payload: row.payload as OutboxEventPayloads[OutboxEventType],
  };
}

export function performedSetsPayload(
  rows: readonly {
    id: number;
    exerciseId: number;
    weight: number;
    reps: number;
    rpe: number | null;
    isFailure: boolean;
    isDropSet: boolean;
  }[],
) {
  const sets: PerformedSetV1[] = rows.map((row) => ({
    setId: row.id,
    exerciseId: row.exerciseId,
    weight: row.weight,
    reps: row.reps,
    rpe: row.rpe,
    isFailure: row.isFailure,
    isDropSet: row.isDropSet,
    volume: row.weight * row.reps,
  }));
  return {
    sets,
    setCount: sets.length,
    exerciseIds: [...new Set(sets.map((set) => set.exerciseId))],
    totalVolume: sets.reduce((total, set) => total + set.volume, 0),
  };
}
