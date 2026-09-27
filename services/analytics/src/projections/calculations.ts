/**
 * Pure read-model calculations. Every projection is recomputed from stored
 * facts (never incremented), so applying the same facts in any order, or
 * twice, yields the same result. All dates are UTC calendar dates.
 */

const DAY_MS = 86_400_000;

export type WorkoutTotals = {
  setCount: number;
  reps: number;
  volumeKg: number;
  durationSeconds: number;
};

export type WeekAggregate = {
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
  durationSeconds: number;
};

export type SetFact = {
  workoutId: number;
  exerciseId: number;
  weightKg: number;
  reps: number;
  finishedAt: Date;
};

export type PersonalRecord = {
  exerciseId: number;
  bestWeightKg: number;
  bestRepsAtWeight: number;
  achievedAt: Date;
  workoutId: number;
  bestE1rmKg: number;
  bestE1rmAchievedAt: Date;
  bestE1rmWorkoutId: number;
};

export type DayProgress = {
  topSetWeightKg: number;
  topSetReps: number;
  e1rmKg: number;
  volumeKg: number;
};

export type Streak = {
  currentStreakDays: number;
  longestStreakDays: number;
  lastWorkoutDate: string;
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Epley estimated one-rep max: weight * (1 + reps / 30). */
export function epley1rm(weightKg: number, reps: number): number {
  return round2(weightKg * (1 + reps / 30));
}

/** `YYYY-MM-DD` of the UTC calendar day that contains `instant`. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** Monday (UTC) of the ISO week containing `instant`, as `YYYY-MM-DD`. */
export function isoWeekStart(instant: Date): string {
  const day = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  );
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
  return utcDate(new Date(day - weekday * DAY_MS));
}

export function addDays(isoDate: string, days: number): string {
  return utcDate(new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS));
}

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round(
    (Date.parse(`${toIsoDate}T00:00:00Z`) -
      Date.parse(`${fromIsoDate}T00:00:00Z`)) /
      DAY_MS,
  );
}

export function totalsOf(sets: readonly { weight: number; reps: number }[]) {
  return {
    setCount: sets.length,
    reps: sets.reduce((sum, set) => sum + set.reps, 0),
    volumeKg: round2(sets.reduce((sum, set) => sum + set.weight * set.reps, 0)),
  };
}

export function aggregateWeek(
  workouts: readonly WorkoutTotals[],
): WeekAggregate {
  return {
    workouts: workouts.length,
    sets: workouts.reduce((sum, w) => sum + w.setCount, 0),
    reps: workouts.reduce((sum, w) => sum + w.reps, 0),
    volumeKg: round2(workouts.reduce((sum, w) => sum + w.volumeKg, 0)),
    durationSeconds: workouts.reduce((sum, w) => sum + w.durationSeconds, 0),
  };
}

/**
 * Streak rule: a streak is a run of consecutive UTC calendar days with at
 * least one finished workout. Several workouts on one day count once. The
 * stored `currentStreakDays` is the run that ends on `lastWorkoutDate`; the
 * read API reports it as 0 once a whole UTC day passes without a workout
 * (see `effectiveCurrentStreak`).
 */
export function computeStreak(dates: readonly string[]): Streak | null {
  const unique = [...new Set(dates)].sort();
  if (!unique.length) return null;
  let run = 1;
  let longest = 1;
  for (let i = 1; i < unique.length; i++) {
    run = daysBetween(unique[i - 1], unique[i]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return {
    currentStreakDays: run,
    longestStreakDays: longest,
    lastWorkoutDate: unique[unique.length - 1],
  };
}

/** The streak is still alive today if the last workout was today or yesterday (UTC). */
export function effectiveCurrentStreak(
  streak: Pick<Streak, 'currentStreakDays' | 'lastWorkoutDate'>,
  now: Date,
): number {
  return daysBetween(streak.lastWorkoutDate, utcDate(now)) <= 1
    ? streak.currentStreakDays
    : 0;
}

function earlier(a: SetFact, b: SetFact): boolean {
  const diff = a.finishedAt.getTime() - b.finishedAt.getTime();
  return diff < 0 || (diff === 0 && a.workoutId < b.workoutId);
}

/**
 * Personal records of one exercise from all its sets. The heaviest set wins
 * by weight, then by reps; the best e1RM wins by Epley value. Ties keep the
 * EARLIEST achievement, so a later equal set never "re-achieves" a record:
 * the record only changes when it is actually beaten.
 */
export function computePersonalRecord(
  exerciseId: number,
  sets: readonly SetFact[],
): PersonalRecord | null {
  let heaviest: SetFact | undefined;
  let bestE1rm: { set: SetFact; value: number } | undefined;
  for (const set of sets) {
    if (
      !heaviest ||
      set.weightKg > heaviest.weightKg ||
      (set.weightKg === heaviest.weightKg &&
        (set.reps > heaviest.reps ||
          (set.reps === heaviest.reps && earlier(set, heaviest))))
    )
      heaviest = set;
    const value = epley1rm(set.weightKg, set.reps);
    if (
      !bestE1rm ||
      value > bestE1rm.value ||
      (value === bestE1rm.value && earlier(set, bestE1rm.set))
    )
      bestE1rm = { set, value };
  }
  if (!heaviest || !bestE1rm) return null;
  return {
    exerciseId,
    bestWeightKg: heaviest.weightKg,
    bestRepsAtWeight: heaviest.reps,
    achievedAt: heaviest.finishedAt,
    workoutId: heaviest.workoutId,
    bestE1rmKg: bestE1rm.value,
    bestE1rmAchievedAt: bestE1rm.set.finishedAt,
    bestE1rmWorkoutId: bestE1rm.set.workoutId,
  };
}

/** One chart point: the day's top set (heaviest, then most reps), best e1RM and volume. */
export function computeDayProgress(
  sets: readonly { weightKg: number; reps: number }[],
): DayProgress | null {
  if (!sets.length) return null;
  let top = sets[0];
  for (const set of sets)
    if (
      set.weightKg > top.weightKg ||
      (set.weightKg === top.weightKg && set.reps > top.reps)
    )
      top = set;
  return {
    topSetWeightKg: top.weightKg,
    topSetReps: top.reps,
    e1rmKg: Math.max(...sets.map((set) => epley1rm(set.weightKg, set.reps))),
    volumeKg: round2(
      sets.reduce((sum, set) => sum + set.weightKg * set.reps, 0),
    ),
  };
}
