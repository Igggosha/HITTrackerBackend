import type {
  DayProgress,
  PersonalRecord,
  SetFact,
  Streak,
  WeekAggregate,
} from '../calculations';
import { utcDate } from '../calculations';
import type {
  BodyMetricFact,
  EventSource,
  FinishedWorkoutFact,
  ScheduledAssignmentFact,
  ReadModelStore,
  ReadModelTx,
} from '../read-model-store';

/** Snapshot of every table, as plain data (compared with `toEqual`). */
export type MemoryState = {
  processed: string[];
  workouts: Map<number, Omit<FinishedWorkoutFact, 'sets'>>;
  sets: Map<number, SetFact & { userId: number }>;
  erased: Map<number, Date>;
  weeks: Map<string, WeekAggregate & { userId: number; isoWeekStart: string }>;
  streaks: Map<number, Streak>;
  records: Map<string, PersonalRecord & { userId: number; writes: number }>;
  progress: Map<string, DayProgress>;
  bodyMetrics: Map<number, BodyMetricFact>;
  assignments: Map<number, ScheduledAssignmentFact>;
};

function emptyState(): MemoryState {
  return {
    processed: [],
    workouts: new Map(),
    sets: new Map(),
    erased: new Map(),
    weeks: new Map(),
    streaks: new Map(),
    records: new Map(),
    progress: new Map(),
    bodyMetrics: new Map(),
    assignments: new Map(),
  };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    processed: [...state.processed],
    workouts: new Map(state.workouts),
    sets: new Map(state.sets),
    erased: new Map(state.erased),
    weeks: new Map(state.weeks),
    streaks: new Map(state.streaks),
    records: new Map(
      [...state.records].map(([key, value]) => [key, { ...value }]),
    ),
    progress: new Map(state.progress),
    bodyMetrics: new Map(state.bodyMetrics),
    assignments: new Map(state.assignments),
  };
}

/**
 * In-memory `ReadModelStore` with the PostgreSQL implementation's semantics
 * (ON CONFLICT DO NOTHING, upserts, "update PR only when changed") and real
 * transactions: `work` runs on a copy that replaces the state only if it
 * resolves, so a failing projection leaves nothing behind.
 */
export class InMemoryReadModelStore implements ReadModelStore {
  state = emptyState();
  /** Errors the next transactions reject with, one per call (outage simulation). */
  failures: Error[] = [];

  async transaction<T>(work: (tx: ReadModelTx) => Promise<T>): Promise<T> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    const draft = cloneState(this.state);
    const result = await work(new MemoryTx(draft));
    this.state = draft;
    return result;
  }
}

class MemoryTx implements ReadModelTx {
  constructor(private readonly s: MemoryState) {}

  markProcessed(event: { id: string }, _source: EventSource) {
    if (this.s.processed.includes(event.id)) return Promise.resolve(false);
    this.s.processed.push(event.id);
    return Promise.resolve(true);
  }

  lockUser() {
    return Promise.resolve();
  }

  isErased(userId: number) {
    return Promise.resolve(this.s.erased.has(userId));
  }

  insertFinishedWorkout(fact: FinishedWorkoutFact) {
    const { sets, ...workout } = fact;
    const existing = this.s.workouts.get(fact.workoutId);
    if (
      existing &&
      JSON.stringify(existing.payload) === JSON.stringify(workout.payload)
    )
      return Promise.resolve(false);
    this.s.workouts.set(fact.workoutId, workout);
    for (const set of sets)
      if (!this.s.sets.has(set.setId))
        this.s.sets.set(set.setId, {
          workoutId: fact.workoutId,
          userId: fact.userId,
          exerciseId: set.exerciseId,
          weightKg: set.weightKg,
          reps: set.reps,
          finishedAt: fact.finishedAt,
        });
    return Promise.resolve(true);
  }

  insertScheduledAssignments(facts: readonly ScheduledAssignmentFact[]) {
    let inserted = 0;
    for (const fact of facts) {
      if (this.s.assignments.has(fact.scheduleId)) continue;
      this.s.assignments.set(fact.scheduleId, fact);
      inserted += 1;
    }
    return Promise.resolve(inserted);
  }

  deleteScheduledAssignments(userId: number, scheduleIds: readonly number[]) {
    let deleted = 0;
    for (const scheduleId of scheduleIds) {
      const assignment = this.s.assignments.get(scheduleId);
      if (assignment?.userId !== userId) continue;
      this.s.assignments.delete(scheduleId);
      deleted += 1;
    }
    return Promise.resolve(deleted);
  }

  workoutTotalsBetween(userId: number, from: Date, to: Date) {
    return Promise.resolve(
      [...this.s.workouts.values()]
        .filter(
          (w) =>
            w.userId === userId && w.finishedAt >= from && w.finishedAt < to,
        )
        .map((w) => ({
          setCount: w.setCount,
          reps: w.reps,
          volumeKg: w.volumeKg,
          durationSeconds: w.durationSeconds,
        })),
    );
  }

  saveWeek(userId: number, isoWeekStart: string, week: WeekAggregate) {
    this.s.weeks.set(`${userId}:${isoWeekStart}`, {
      userId,
      isoWeekStart,
      ...week,
    });
    return Promise.resolve();
  }

  workoutDates(userId: number) {
    return Promise.resolve([
      ...new Set(
        [...this.s.workouts.values()]
          .filter((w) => w.userId === userId)
          .map((w) => utcDate(w.finishedAt)),
      ),
    ]);
  }

  saveStreak(userId: number, streak: Streak) {
    this.s.streaks.set(userId, streak);
    return Promise.resolve();
  }

  setsFor(userId: number, exerciseIds: readonly number[]) {
    return Promise.resolve(
      [...this.s.sets.values()]
        .filter(
          (s) => s.userId === userId && exerciseIds.includes(s.exerciseId),
        )
        .map(({ userId: _userId, ...set }) => set),
    );
  }

  savePersonalRecords(userId: number, records: readonly PersonalRecord[]) {
    for (const record of records) {
      const key = `${userId}:${record.exerciseId}`;
      const existing = this.s.records.get(key);
      const changed =
        !existing ||
        existing.bestWeightKg !== record.bestWeightKg ||
        existing.bestRepsAtWeight !== record.bestRepsAtWeight ||
        existing.achievedAt.getTime() !== record.achievedAt.getTime() ||
        existing.workoutId !== record.workoutId ||
        existing.bestE1rmKg !== record.bestE1rmKg ||
        existing.bestE1rmAchievedAt.getTime() !==
          record.bestE1rmAchievedAt.getTime() ||
        existing.bestE1rmWorkoutId !== record.bestE1rmWorkoutId;
      if (changed)
        this.s.records.set(key, {
          userId,
          ...record,
          writes: (existing?.writes ?? 0) + 1,
        });
    }
    return Promise.resolve();
  }

  saveExerciseProgress(
    userId: number,
    exerciseId: number,
    date: string,
    progress: DayProgress,
  ) {
    this.s.progress.set(`${userId}:${exerciseId}:${date}`, progress);
    return Promise.resolve();
  }

  insertBodyMetric(fact: BodyMetricFact) {
    if (this.s.bodyMetrics.has(fact.metricId)) return Promise.resolve(false);
    this.s.bodyMetrics.set(fact.metricId, fact);
    return Promise.resolve(true);
  }

  eraseUser(userId: number, erasedAt: Date) {
    const drop = <V>(map: Map<unknown, V>, owner: (v: V) => number) => {
      for (const [key, value] of map)
        if (owner(value) === userId) map.delete(key);
    };
    drop(this.s.workouts, (w) => w.userId);
    drop(this.s.sets, (s) => s.userId);
    drop(this.s.weeks, (w) => w.userId);
    drop(this.s.records, (r) => r.userId);
    drop(this.s.bodyMetrics, (m) => m.userId);
    drop(this.s.assignments, (assignment) => assignment.userId);
    this.s.streaks.delete(userId);
    for (const key of [...this.s.progress.keys()])
      if (key.startsWith(`${userId}:`)) this.s.progress.delete(key);
    if (!this.s.erased.has(userId)) this.s.erased.set(userId, erasedAt);
    return Promise.resolve();
  }
}
