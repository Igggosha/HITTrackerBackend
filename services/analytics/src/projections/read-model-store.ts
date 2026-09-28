import type {
  DayProgress,
  PersonalRecord,
  SetFact,
  Streak,
  WeekAggregate,
  WorkoutTotals,
} from './calculations';

export type EventSource = {
  topic: string;
  partition: number;
  offset: string;
};

export type FinishedWorkoutFact = {
  workoutId: number;
  userId: number;
  eventId: string;
  startedAt: Date;
  finishedAt: Date;
  durationSeconds: number;
  setCount: number;
  reps: number;
  volumeKg: number;
  payload: Record<string, unknown>;
  sets: {
    setId: number;
    exerciseId: number;
    weightKg: number;
    reps: number;
  }[];
};

export type BodyMetricFact = {
  metricId: number;
  userId: number;
  recordedAt: Date;
  weight: number | null;
  bodyFatPercentage: number | null;
  muscleMass: number | null;
  waistCircumference: number | null;
};

/**
 * Everything a projection may do inside ONE database transaction. The
 * PostgreSQL implementation (`PgReadModelStore`) is the real one; unit tests
 * use an in-memory implementation with the same semantics, so projection
 * logic, idempotency and ordering are testable without a database.
 */
export interface ReadModelTx {
  /** Inserts into `processed_events`; `false` if the event id was already there. */
  markProcessed(
    event: { id: string; type: string; version: number },
    source: EventSource,
  ): Promise<boolean>;
  /**
   * Serialises this user's projections across consumer instances (a
   * transaction-scoped advisory lock): e.g. a `user.deleted` consumed from
   * hit.user.v1 can never interleave with a `workout.finished` of the same
   * user consumed from hit.workout.v1 by another instance.
   */
  lockUser(userId: number): Promise<void>;
  isErased(userId: number): Promise<boolean>;
  /** Inserts the workout and its sets; `false` if the workout id already exists. */
  insertFinishedWorkout(fact: FinishedWorkoutFact): Promise<boolean>;
  workoutTotalsBetween(
    userId: number,
    fromInclusive: Date,
    toExclusive: Date,
  ): Promise<WorkoutTotals[]>;
  saveWeek(
    userId: number,
    isoWeekStart: string,
    aggregate: WeekAggregate,
  ): Promise<void>;
  /** Distinct UTC dates (`YYYY-MM-DD`) with at least one finished workout. */
  workoutDates(userId: number): Promise<string[]>;
  saveStreak(userId: number, streak: Streak): Promise<void>;
  setsFor(userId: number, exerciseIds: readonly number[]): Promise<SetFact[]>;
  /** Upserts; a row whose values did not change is left untouched. */
  savePersonalRecords(
    userId: number,
    records: readonly PersonalRecord[],
  ): Promise<void>;
  saveExerciseProgress(
    userId: number,
    exerciseId: number,
    date: string,
    progress: DayProgress,
  ): Promise<void>;
  /** `false` if the metric id already exists. */
  insertBodyMetric(fact: BodyMetricFact): Promise<boolean>;
  /** Deletes every row of the user and records a tombstone. */
  eraseUser(userId: number, erasedAt: Date): Promise<void>;
}

export interface ReadModelStore {
  transaction<T>(work: (tx: ReadModelTx) => Promise<T>): Promise<T>;
}

export const READ_MODEL_STORE = Symbol('READ_MODEL_STORE');
