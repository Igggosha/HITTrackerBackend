import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { ANALYTICS_DB, type AnalyticsDb } from '../db/database';
import {
  bodyMetricsTimeline,
  exerciseProgress,
  finishedWorkouts,
  personalRecords,
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
const DAY_MS = 86_400_000;

type WorkoutSet = {
  exerciseId: number;
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

  async overview(userId: number, query: { from: string; to: string }) {
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
        durationSeconds: finishedWorkouts.durationSeconds,
        setCount: finishedWorkouts.setCount,
        volumeKg: finishedWorkouts.volumeKg,
        payload: finishedWorkouts.payload,
      })
      .from(finishedWorkouts)
      .where(workoutConditions(userId, range.from, range.toExclusive))
      .orderBy(asc(finishedWorkouts.finishedAt))) as WorkoutFact[];
    const workouts = rows.map(asWorkoutFact);
    const rpes = workouts.flatMap((workout) =>
      workout.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe])),
    );
    const activityByDate = new Map<
      string,
      { volumeKg: number; completedWorkouts: number }
    >();
    for (const workout of workouts) {
      const date = utcDate(workout.finishedAt);
      const day = activityByDate.get(date) ?? {
        volumeKg: 0,
        completedWorkouts: 0,
      };
      day.volumeKg += workout.volumeKg;
      day.completedWorkouts += 1;
      activityByDate.set(date, day);
    }

    const activity = [];
    for (
      let time = Date.UTC(
        range.from.getUTCFullYear(),
        range.from.getUTCMonth(),
        range.from.getUTCDate(),
      );
      time < range.toExclusive.getTime();
      time += DAY_MS
    ) {
      const date = new Date(time).toISOString().slice(0, 10);
      const day = activityByDate.get(date);
      activity.push({
        date,
        volumeKg: round2(day?.volumeKg ?? 0),
        plannedWorkouts: null,
        completedWorkouts: day?.completedWorkouts ?? 0,
      });
    }

    const intensityByDate = new Map<string, number[]>();
    for (const workout of workouts) {
      const date = utcDate(workout.finishedAt);
      const dailyRpes = intensityByDate.get(date) ?? [];
      dailyRpes.push(
        ...workout.sets.flatMap((set) => (set.rpe === null ? [] : [set.rpe])),
      );
      intensityByDate.set(date, dailyRpes);
    }

    return {
      summary: {
        workouts: workouts.length,
        plannedWorkouts: null,
        completedWorkouts: workouts.length,
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
        caloriesKcal: null,
        averageRpe: rpes.length
          ? round2(rpes.reduce((total, rpe) => total + rpe, 0) / rpes.length)
          : null,
      },
      activity,
      intensityTrend: [...intensityByDate]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, values]) => ({
          date,
          averageRpe: values.length
            ? round2(
                values.reduce((total, value) => total + value, 0) /
                  values.length,
              )
            : null,
        })),
      muscleGroups: [],
    };
  }

  async intensity(userId: number, date: string) {
    const from = new Date(`${date}T00:00:00.000Z`);
    const toExclusive = new Date(from.getTime() + DAY_MS);
    const rows = (await this.db
      .select({
        durationSeconds: finishedWorkouts.durationSeconds,
        volumeKg: finishedWorkouts.volumeKg,
        payload: finishedWorkouts.payload,
      })
      .from(finishedWorkouts)
      .where(workoutConditions(userId, from, toExclusive))) as Pick<
      WorkoutFact,
      'durationSeconds' | 'volumeKg' | 'payload'
    >[];
    const workouts = rows.map((row) => ({
      ...row,
      sets: setsFromPayload(row.payload),
    }));
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
    const ranges = [
      { range: '1-2', min: 1, max: 2 },
      { range: '3-4', min: 3, max: 4 },
      { range: '5-6', min: 5, max: 6 },
      { range: '7-8', min: 7, max: 8 },
      { range: '9-10', min: 9, max: 10 },
    ];
    return {
      averageRpe: rpes.length
        ? round2(rpes.reduce((total, rpe) => total + rpe, 0) / rpes.length)
        : null,
      volumePerMinute:
        activeSeconds > 0 ? round2(totalVolume / (activeSeconds / 60)) : null,
      setsToFailure: sets.filter((set) => set.isFailure).length,
      totalSets: sets.length,
      rpeDistribution: rpes.length
        ? ranges.map(({ range, min, max }) => {
            const count = rpes.filter((rpe) => rpe >= min && rpe <= max).length;
            return {
              range,
              sets: count,
              percentage: round2((count / rpes.length) * 100),
            };
          })
        : [],
    };
  }

  muscleGroups(
    _userId: number,
    query: { from: string; to: string; metric: 'workingSets' | 'volume' },
  ) {
    rangeQuery(query);
    // Exercise-to-muscle mappings and catalog names are not included in the
    // analytics event stream, so an empty result is more honest than guessing.
    return { muscleGroups: [] };
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
          .map((set) => ({
            date: utcDate(workout.finishedAt),
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
