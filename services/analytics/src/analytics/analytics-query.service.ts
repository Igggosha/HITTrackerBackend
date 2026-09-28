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
