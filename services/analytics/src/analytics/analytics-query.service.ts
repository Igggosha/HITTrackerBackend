import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  lte,
} from 'drizzle-orm';
import { ANALYTICS_DB, type AnalyticsDb } from '../db/database';
import {
  bodyMetricsTimeline,
  exerciseProgress,
  finishedWorkouts,
  personalRecords,
  scheduledAssignments,
  trainingStreaks,
  weeklyVolume,
} from '../db/schema';
import {
  addDays,
  effectiveCurrentStreak,
  isoWeekStart,
  round2,
  utcDate,
} from '../projections/calculations';
import type { DateRangeQueryDto } from './analytics.dto';

const MAX_POINTS = 1000;

type WorkoutSet = {
  setId?: number;
  exerciseId: number;
  exerciseName?: string;
  muscleGroups?: { id: number; commonName: string }[];
  weight: number;
  reps: number;
  rpe: number | null;
  isFailure: boolean;
};

type WorkoutFact = {
  workoutId: number;
  finishedAt: Date;
  durationSeconds: number;
  setCount: number;
  volumeKg: number;
  payload: Record<string, unknown>;
};

function setsFromPayload(payload: Record<string, unknown>): WorkoutSet[] {
  const sets = payload.sets;
  if (!Array.isArray(sets)) return [];
  return sets.filter(
    (set): set is WorkoutSet =>
      typeof set === 'object' &&
      set !== null &&
      typeof (set as WorkoutSet).exerciseId === 'number' &&
      typeof (set as WorkoutSet).weight === 'number' &&
      typeof (set as WorkoutSet).reps === 'number' &&
      ((set as WorkoutSet).rpe === null ||
        typeof (set as WorkoutSet).rpe === 'number') &&
      typeof (set as WorkoutSet).isFailure === 'boolean',
  );
}

function timeZoneOf(value?: string) {
  const timeZone = value || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new BadRequestException({
      message: '`timeZone` must be a valid IANA time zone',
      code: 'INVALID_TIME_ZONE',
    });
  }
}

function localDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function selectedDateKeys(
  range: { from: Date; toExclusive: Date },
  timeZone: string,
) {
  return {
    from: localDate(range.from, timeZone),
    to: localDate(new Date(range.toExclusive.getTime() - 1), timeZone),
  };
}

function dateKeys(from: string, to: string) {
  const keys: string[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key);
  return keys;
}

function percentage(part: number, whole: number) {
  return whole ? round2((part / whole) * 100) : null;
}

export function scheduleStats(
  assignments: { scheduleId: number; scheduledFor: string }[],
  completions: Map<number, Date>,
  today: string,
  timeZone: string,
) {
  const ended = assignments.filter((item) => item.scheduledFor < today);
  const completedAssignments = ended.filter((item) =>
    completions.has(item.scheduleId),
  ).length;
  const byDate = new Map<string, typeof assignments>();
  for (const assignment of assignments.filter(
    (item) => item.scheduledFor <= today,
  )) {
    const day = byDate.get(assignment.scheduledFor) ?? [];
    day.push(assignment);
    byDate.set(assignment.scheduledFor, day);
  }
  let currentStreakDays = 0;
  let longestStreakDays = 0;
  for (const [date, day] of [...byDate].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const successful = day.every((assignment) => {
      const finishedAt = completions.get(assignment.scheduleId);
      return finishedAt && localDate(finishedAt, timeZone) === date;
    });
    if (date === today && !successful) continue;
    currentStreakDays = successful ? currentStreakDays + 1 : 0;
    longestStreakDays = Math.max(longestStreakDays, currentStreakDays);
  }
  return {
    completedAssignments,
    scheduledAssignments: ended.length,
    adherencePercent: percentage(completedAssignments, ended.length),
    currentStreakDays,
    longestStreakDays,
  };
}

function rangeQuery(query: { from: string; to: string }) {
  const range = parseRange(query);
  if (!range.from || !range.toExclusive)
    throw new BadRequestException('Both `from` and `to` are required');
  return range as { from: Date; toExclusive: Date };
}

function workoutConditions(userId: number, from: Date, toExclusive: Date) {
  return and(
    eq(finishedWorkouts.userId, userId),
    gte(finishedWorkouts.finishedAt, from),
    lt(finishedWorkouts.finishedAt, toExclusive),
  );
}

function asWorkoutFact(row: WorkoutFact) {
  return { ...row, sets: setsFromPayload(row.payload) };
}

export type WeekVolume = {
  isoWeekStart: string;
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
  durationSeconds: number;
};

const emptyWeek = (start: string): WeekVolume => ({
  isoWeekStart: start,
  workouts: 0,
  sets: 0,
  reps: 0,
  volumeKg: 0,
  durationSeconds: 0,
});

type Range = { from?: Date; toExclusive?: Date };

/** Date-only `to` is inclusive of that whole UTC day. */
function parseRange(query: DateRangeQueryDto): Range {
  const from = query.from ? new Date(query.from) : undefined;
  let toExclusive: Date | undefined;
  if (query.to) {
    const to = new Date(query.to);
    toExclusive = /^\d{4}-\d{2}-\d{2}$/.test(query.to)
      ? new Date(to.getTime() + 86_400_000)
      : new Date(to.getTime() + 1);
  }
  if (from && toExclusive && from >= toExclusive)
    throw new BadRequestException({
      message: '`from` must not be after `to`',
      code: 'INVALID_DATE_RANGE',
    });
  return { from, toExclusive };
}

/**
 * Plain reads of the read models: no computation beyond formatting, which
 * is the point of CQRS. Numbers are rounded to 2 decimals; units are in the
 * field names.
 */
@Injectable()
export class AnalyticsQueryService {
  constructor(@Inject(ANALYTICS_DB) private readonly db: AnalyticsDb) {}

  async summary(userId: number, now: Date) {
    const thisWeek = isoWeekStart(now);
    const lastWeek = addDays(thisWeek, -7);
    const [weeks, [streak], [prs], [last]] = await Promise.all([
      this.db
        .select()
        .from(weeklyVolume)
        .where(
          and(
            eq(weeklyVolume.userId, userId),
            gte(weeklyVolume.isoWeekStart, lastWeek),
            lte(weeklyVolume.isoWeekStart, thisWeek),
          ),
        ),
      this.db
        .select()
        .from(trainingStreaks)
        .where(eq(trainingStreaks.userId, userId)),
      this.db
        .select({ value: count() })
        .from(personalRecords)
        .where(eq(personalRecords.userId, userId)),
      this.db
        .select({
          workoutId: finishedWorkouts.workoutId,
          finishedAt: finishedWorkouts.finishedAt,
          durationSeconds: finishedWorkouts.durationSeconds,
          setCount: finishedWorkouts.setCount,
          volumeKg: finishedWorkouts.volumeKg,
        })
        .from(finishedWorkouts)
        .where(eq(finishedWorkouts.userId, userId))
        .orderBy(desc(finishedWorkouts.finishedAt))
        .limit(1),
    ]);
    const pick = (start: string) =>
      this.toWeek(weeks.find((w) => w.isoWeekStart === start)) ??
      emptyWeek(start);
    const current = pick(thisWeek);
    const previous = pick(lastWeek);
    return {
      userId,
      generatedAt: now.toISOString(),
      thisWeek: current,
      lastWeek: previous,
      volumeChangePercent:
        previous.volumeKg > 0
          ? round2(
              ((current.volumeKg - previous.volumeKg) / previous.volumeKg) *
                100,
            )
          : null,
      streak: {
        currentDays: streak ? effectiveCurrentStreak(streak, now) : 0,
        longestDays: streak?.longestStreakDays ?? 0,
        lastWorkoutDate: streak?.lastWorkoutDate ?? null,
      },
      personalRecordCount: Number(prs?.value ?? 0),
      lastWorkout: last
        ? {
            workoutId: last.workoutId,
            finishedAt: last.finishedAt.toISOString(),
            durationSeconds: last.durationSeconds,
            setCount: last.setCount,
            volumeKg: round2(last.volumeKg),
          }
        : null,
    };
  }

  /** `weeks` ISO weeks ending with the current one, oldest first, gaps as zeros. */
  async weeklyVolume(userId: number, weeks: number, now: Date) {
    const thisWeek = isoWeekStart(now);
    const first = addDays(thisWeek, -7 * (weeks - 1));
    const rows = await this.db
      .select()
      .from(weeklyVolume)
      .where(
        and(
          eq(weeklyVolume.userId, userId),
          gte(weeklyVolume.isoWeekStart, first),
          lte(weeklyVolume.isoWeekStart, thisWeek),
        ),
      );
    const result: WeekVolume[] = [];
    for (let i = 0; i < weeks; i++) {
      const start = addDays(first, 7 * i);
      result.push(
        this.toWeek(rows.find((row) => row.isoWeekStart === start)) ??
          emptyWeek(start),
      );
    }
    return { weeks: result };
  }

  async personalRecords(userId: number) {
    const rows = await this.db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId))
      .orderBy(asc(personalRecords.exerciseId));
    return {
      records: rows.map((row) => ({
        exerciseId: row.exerciseId,
        bestWeightKg: round2(row.bestWeightKg),
        bestRepsAtWeight: row.bestRepsAtWeight,
        achievedAt: row.achievedAt.toISOString(),
        workoutId: row.workoutId,
        bestE1rmKg: round2(row.bestE1rmKg),
        bestE1rmAchievedAt: row.bestE1rmAchievedAt.toISOString(),
        bestE1rmWorkoutId: row.bestE1rmWorkoutId,
      })),
    };
  }

  private async periodWorkouts(
    userId: number,
    query: { from: string; to: string },
  ) {
    const range = rangeQuery(query);
    const rows = (await this.db
      .select({
        workoutId: finishedWorkouts.workoutId,
        finishedAt: finishedWorkouts.finishedAt,
        durationSeconds: finishedWorkouts.durationSeconds,
        setCount: finishedWorkouts.setCount,
        volumeKg: finishedWorkouts.volumeKg,
        payload: finishedWorkouts.payload,
      })
      .from(finishedWorkouts)
      .where(workoutConditions(userId, range.from, range.toExclusive))
      .orderBy(asc(finishedWorkouts.finishedAt))) as WorkoutFact[];
    return { range, workouts: rows.map(asWorkoutFact) };
  }

  private muscleTotals(workouts: ReturnType<typeof asWorkoutFact>[]) {
    const groups = new Map<
      number,
      { muscleId: number; name: string; workingSets: number }
    >();
    for (const set of workouts.flatMap((workout) => workout.sets)) {
      for (const muscle of set.muscleGroups ?? []) {
        if (!Number.isInteger(muscle.id) || !muscle.commonName) continue;
        const current = groups.get(muscle.id) ?? {
          muscleId: muscle.id,
          name: muscle.commonName,
          workingSets: 0,
        };
        current.workingSets += 1;
        groups.set(muscle.id, current);
      }
    }
    return [...groups.values()].sort(
      (left, right) =>
        right.workingSets - left.workingSets ||
        left.name.localeCompare(right.name),
    );
  }

  async overview(
    userId: number,
    query: { from: string; to: string; timeZone?: string },
  ) {
    const timeZone = timeZoneOf(query.timeZone);
    const { range, workouts } = await this.periodWorkouts(userId, query);
    const keys = selectedDateKeys(range, timeZone);
    const [selectedAssignments, allAssignments, completedScheduled] =
      await Promise.all([
        this.db
          .select()
          .from(scheduledAssignments)
          .where(
            and(
              eq(scheduledAssignments.userId, userId),
              gte(scheduledAssignments.scheduledFor, keys.from),
              lte(scheduledAssignments.scheduledFor, keys.to),
            ),
          ),
        this.db
          .select()
          .from(scheduledAssignments)
          .where(eq(scheduledAssignments.userId, userId)),
        this.db
          .select({
            scheduleId: finishedWorkouts.scheduleId,
            finishedAt: finishedWorkouts.finishedAt,
          })
          .from(finishedWorkouts)
          .where(
            and(
              eq(finishedWorkouts.userId, userId),
              isNotNull(finishedWorkouts.scheduleId),
            ),
          ),
      ]);
    const completions = new Map<number, Date>();
    for (const row of completedScheduled) {
      if (row.scheduleId == null) continue;
      const existing = completions.get(row.scheduleId);
      if (!existing || row.finishedAt < existing)
        completions.set(row.scheduleId, row.finishedAt);
    }
    const today = localDate(new Date(), timeZone);
    const periodPlan = scheduleStats(
      selectedAssignments,
      completions,
      today,
      timeZone,
    );
    const streak = scheduleStats(allAssignments, completions, today, timeZone);
    const rpes = workouts.flatMap((workout) =>
      workout.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe])),
    );
    const activityByDate = new Map<
      string,
      { volumeKg: number; completedWorkouts: number; plannedWorkouts: number }
    >();
    for (const date of dateKeys(keys.from, keys.to))
      activityByDate.set(date, {
        volumeKg: 0,
        completedWorkouts: 0,
        plannedWorkouts: 0,
      });
    for (const assignment of selectedAssignments) {
      const day = activityByDate.get(assignment.scheduledFor);
      if (day) day.plannedWorkouts += 1;
    }
    const intensityByDate = new Map<string, number[]>();
    for (const workout of workouts) {
      const date = localDate(workout.finishedAt, timeZone);
      const day = activityByDate.get(date);
      if (day) {
        day.volumeKg += workout.volumeKg;
        day.completedWorkouts += 1;
      }
      const values = intensityByDate.get(date) ?? [];
      values.push(
        ...workout.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe])),
      );
      intensityByDate.set(date, values);
    }
    const muscleGroups = this.muscleTotals(workouts);
    return {
      summary: {
        workouts: workouts.length,
        activeMinutes: round2(
          workouts.reduce(
            (total, workout) => total + workout.durationSeconds,
            0,
          ) / 60,
        ),
        workingSets: workouts.reduce(
          (total, workout) => total + workout.setCount,
          0,
        ),
        volumeKg: round2(
          workouts.reduce((total, workout) => total + workout.volumeKg, 0),
        ),
        averageRpe: rpes.length
          ? round2(rpes.reduce((total, rpe) => total + rpe, 0) / rpes.length)
          : null,
      },
      plan: {
        ...periodPlan,
        currentStreakDays: streak.currentStreakDays,
        longestStreakDays: streak.longestStreakDays,
      },
      activity: [...activityByDate].map(([date, day]) => ({
        date,
        ...day,
        volumeKg: round2(day.volumeKg),
      })),
      intensityTrend: dateKeys(keys.from, keys.to).map((date) => {
        const values = intensityByDate.get(date) ?? [];
        return {
          date,
          averageRpe: values.length
            ? round2(
                values.reduce((total, value) => total + value, 0) /
                  values.length,
              )
            : null,
        };
      }),
      muscleGroups: muscleGroups.slice(0, 5),
    };
  }

  async intensity(
    userId: number,
    query: { from: string; to: string; timeZone?: string },
  ) {
    const timeZone = timeZoneOf(query.timeZone);
    const { workouts } = await this.periodWorkouts(userId, query);
    const sets = workouts.flatMap((workout) => workout.sets);
    const rpes = sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe]));
    const totalVolume = workouts.reduce(
      (total, workout) => total + workout.volumeKg,
      0,
    );
    const activeSeconds = workouts.reduce(
      (total, workout) => total + workout.durationSeconds,
      0,
    );
    const trend = new Map<string, { rpes: number[]; volumeKg: number }>();
    for (const workout of workouts) {
      const date = localDate(workout.finishedAt, timeZone);
      const day = trend.get(date) ?? { rpes: [], volumeKg: 0 };
      day.rpes.push(
        ...workout.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe])),
      );
      day.volumeKg += workout.volumeKg;
      trend.set(date, day);
    }
    const ranges = [
      { range: '4-5', min: 4, max: 5 },
      { range: '6-7', min: 6, max: 7 },
      { range: '8-10', min: 8, max: 10 },
    ];
    const setsToFailure = sets.filter((set) => set.isFailure).length;
    return {
      averageRpe: rpes.length
        ? round2(rpes.reduce((total, rpe) => total + rpe, 0) / rpes.length)
        : null,
      volumePerMinute:
        activeSeconds > 0 ? round2(totalVolume / (activeSeconds / 60)) : null,
      totalVolumeKg: round2(totalVolume),
      setsToFailure,
      totalSets: sets.length,
      failurePercentage: percentage(setsToFailure, sets.length),
      trend: [...trend]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, day]) => ({
          date,
          averageRpe: day.rpes.length
            ? round2(
                day.rpes.reduce((total, value) => total + value, 0) /
                  day.rpes.length,
              )
            : null,
          volumeKg: round2(day.volumeKg),
        })),
      rpeDistribution: ranges.map(({ range: label, min, max }) => {
        const count = rpes.filter((rpe) => rpe >= min && rpe <= max).length;
        return {
          range: label,
          sets: count,
          percentage: percentage(count, rpes.length) ?? 0,
        };
      }),
    };
  }

  async muscleGroups(
    userId: number,
    query: { from: string; to: string; timeZone?: string },
  ) {
    const { workouts } = await this.periodWorkouts(userId, query);
    return { muscleGroups: this.muscleTotals(workouts) };
  }

  async strength(userId: number, query: { from: string; to: string }) {
    const { workouts } = await this.periodWorkouts(userId, query);
    const grouped = new Map<
      number,
      {
        exerciseId: number;
        name: string | null;
        sets: (WorkoutSet & { finishedAt: Date; workoutId: number })[];
      }
    >();
    for (const workout of workouts) {
      for (const set of workout.sets) {
        const exercise = grouped.get(set.exerciseId) ?? {
          exerciseId: set.exerciseId,
          name: set.exerciseName ?? null,
          sets: [],
        };
        exercise.name ??= set.exerciseName ?? null;
        exercise.sets.push({
          ...set,
          finishedAt: workout.finishedAt,
          workoutId: workout.workoutId,
        });
        grouped.set(set.exerciseId, exercise);
      }
    }
    return {
      exercises: [...grouped.values()]
        .map((exercise) => {
          const ordered = [...exercise.sets].sort(
            (left, right) =>
              left.finishedAt.getTime() - right.finishedAt.getTime(),
          );
          const latest = ordered.at(-1)!;
          const best = ordered.reduce((winner, set) =>
            set.weight > winner.weight ||
            (set.weight === winner.weight && set.reps > winner.reps)
              ? set
              : winner,
          );
          const bestE1rmKg = Math.max(
            ...ordered.map((set) => set.weight * (1 + set.reps / 30)),
          );
          return {
            exerciseId: exercise.exerciseId,
            name: exercise.name,
            lastSetWeightKg: round2(latest.weight),
            lastSetReps: latest.reps,
            bestWeightKg: round2(best.weight),
            bestRepsAtWeight: best.reps,
            bestE1rmKg: round2(bestE1rmKg),
            changeKg: round2(latest.weight - ordered[0].weight),
          };
        })
        .sort((left, right) =>
          (left.name ?? '').localeCompare(right.name ?? ''),
        ),
    };
  }

  async exerciseSets(
    userId: number,
    exerciseId: number,
    query: { from: string; to: string },
  ) {
    if (!Number.isInteger(exerciseId) || exerciseId < 1)
      throw new BadRequestException('exerciseId must be a positive integer');
    const range = rangeQuery(query);
    if (range.from > new Date(range.toExclusive.getTime() - 1))
      throw new BadRequestException({
        message: '`from` must not be after `to`',
        code: 'INVALID_DATE_RANGE',
      });
    const rows = (await this.db
      .select({
        workoutId: finishedWorkouts.workoutId,
        finishedAt: finishedWorkouts.finishedAt,
        payload: finishedWorkouts.payload,
      })
      .from(finishedWorkouts)
      .where(workoutConditions(userId, range.from, range.toExclusive))
      .orderBy(asc(finishedWorkouts.finishedAt))) as Pick<
      WorkoutFact,
      'workoutId' | 'finishedAt' | 'payload'
    >[];
    return {
      sets: rows.flatMap((workout) =>
        setsFromPayload(workout.payload)
          .filter((set) => set.exerciseId === exerciseId)
          .map((set, index) => ({
            date: utcDate(workout.finishedAt),
            finishedAt: workout.finishedAt.toISOString(),
            setNumber: index + 1,
            workoutId: workout.workoutId,
            weightKg: round2(set.weight),
            reps: set.reps,
            ...(set.rpe === null ? {} : { rpe: set.rpe }),
            isFailure: set.isFailure,
          })),
      ),
    };
  }

  async exerciseProgress(
    userId: number,
    exerciseId: number,
    query: DateRangeQueryDto,
  ) {
    const range = parseRange(query);
    const conditions = [
      eq(exerciseProgress.userId, userId),
      eq(exerciseProgress.exerciseId, exerciseId),
    ];
    if (range.from)
      conditions.push(gte(exerciseProgress.date, utcDate(range.from)));
    if (range.toExclusive)
      conditions.push(
        lte(
          exerciseProgress.date,
          utcDate(new Date(range.toExclusive.getTime() - 1)),
        ),
      );
    const rows = await this.db
      .select()
      .from(exerciseProgress)
      .where(and(...conditions))
      .orderBy(asc(exerciseProgress.date))
      .limit(MAX_POINTS);
    return {
      exerciseId,
      points: rows.map((row) => ({
        date: row.date,
        topSetWeightKg: round2(row.topSetWeightKg),
        topSetReps: row.topSetReps,
        e1rmKg: round2(row.e1rmKg),
        volumeKg: round2(row.volumeKg),
      })),
    };
  }

  async bodyMetrics(userId: number, query: DateRangeQueryDto) {
    const range = parseRange(query);
    const conditions = [eq(bodyMetricsTimeline.userId, userId)];
    if (range.from)
      conditions.push(gte(bodyMetricsTimeline.recordedAt, range.from));
    if (range.toExclusive)
      conditions.push(lt(bodyMetricsTimeline.recordedAt, range.toExclusive));
    const rows = await this.db
      .select()
      .from(bodyMetricsTimeline)
      .where(and(...conditions))
      .orderBy(asc(bodyMetricsTimeline.recordedAt))
      .limit(MAX_POINTS);
    return {
      points: rows.map((row) => ({
        recordedAt: row.recordedAt.toISOString(),
        weightKg: row.weight,
        bodyFatPercentage: row.bodyFatPercentage,
        muscleMassKg: row.muscleMass,
        waistCircumferenceCm: row.waistCircumference,
      })),
    };
  }

  private toWeek(
    row: typeof weeklyVolume.$inferSelect | undefined,
  ): WeekVolume | undefined {
    return row
      ? {
          isoWeekStart: row.isoWeekStart,
          workouts: row.workouts,
          sets: row.sets,
          reps: row.reps,
          volumeKg: round2(row.volumeKg),
          durationSeconds: row.durationSeconds,
        }
      : undefined;
  }
}
