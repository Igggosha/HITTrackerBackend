import { PgDialect } from 'drizzle-orm/pg-core';
import type { AnalyticsDb } from '../db/database';
import {
  AnalyticsQueryService,
  scheduleStats,
} from './analytics-query.service';

type QueryBuilder = Promise<Record<string, unknown>[]> & {
  from: jest.Mock<QueryBuilder, [unknown]>;
  where: jest.Mock<QueryBuilder, [unknown]>;
  orderBy: jest.Mock<Promise<Record<string, unknown>[]>, [unknown]>;
};

function queryBuilder(rows: Record<string, unknown>[]) {
  const builder = Promise.resolve(rows) as QueryBuilder;
  builder.from = jest.fn<QueryBuilder, [unknown]>().mockReturnValue(builder);
  builder.where = jest.fn<QueryBuilder, [unknown]>().mockReturnValue(builder);
  builder.orderBy = jest
    .fn<Promise<Record<string, unknown>[]>, [unknown]>()
    .mockResolvedValue(rows);
  return builder;
}

function setup(
  rows: Record<string, unknown>[] = [],
  following: Record<string, unknown>[][] = [],
) {
  const builders = [queryBuilder(rows), ...following.map(queryBuilder)];
  const select = jest
    .fn<QueryBuilder, []>()
    .mockImplementation(() => builders.shift() ?? queryBuilder([]));
  const db = { select } as unknown as AnalyticsDb;
  return {
    service: new AnalyticsQueryService(db),
    builder: builders[0] ?? queryBuilder([]),
  };
}

function workout(
  workoutId: number,
  finishedAt: string,
  sets: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    workoutId,
    finishedAt: new Date(finishedAt),
    durationSeconds: 600,
    setCount: sets.length,
    volumeKg: sets.reduce(
      (total, set) => total + Number(set.weight) * Number(set.reps),
      0,
    ),
    payload: { sets },
    ...overrides,
  };
}

const set = (
  exerciseId: number,
  weight: number,
  reps: number,
  rpe: number | null,
  isFailure: boolean,
) => ({ exerciseId, weight, reps, rpe, isFailure });

function sqlAndParams(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

describe('AnalyticsQueryService new read models', () => {
  it('aggregates overview facts and leaves unavailable measurements null/empty', async () => {
    const { service } = setup(
      [
        workout(
          11,
          '2026-08-21T10:00:00.000Z',
          [set(3, 100, 5, 6, false), set(4, 80, 5, null, true)],
          { durationSeconds: 900 },
        ),
        workout(12, '2026-08-22T10:00:00.000Z', [set(3, 100, 5, 8, false)]),
      ],
      [[], [], []],
    );

    const result = await service.overview(7, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-22T23:59:59Z',
    });

    expect(result.summary).toEqual({
      workouts: 2,
      activeMinutes: 25,
      workingSets: 3,
      volumeKg: 1400,
      averageRpe: 7,
    });
    expect(result.plan).toMatchObject({
      completedAssignments: 0,
      scheduledAssignments: 0,
      adherencePercent: null,
    });
    expect(result.activity).toEqual([
      {
        date: '2026-08-21',
        volumeKg: 900,
        plannedWorkouts: 0,
        completedWorkouts: 1,
      },
      {
        date: '2026-08-22',
        volumeKg: 500,
        plannedWorkouts: 0,
        completedWorkouts: 1,
      },
    ]);
    expect(result.intensityTrend).toEqual([
      { date: '2026-08-21', averageRpe: 6 },
      { date: '2026-08-22', averageRpe: 8 },
    ]);
    expect(result.muscleGroups).toEqual([]);
  });

  it('returns stable overview empty values and null RPE for unrated sets', async () => {
    const { service } = setup(
      [workout(1, '2026-08-21T10:00:00Z', [set(3, 20, 5, null, false)])],
      [[], [], []],
    );

    const result = await service.overview(7, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-21T23:59:59Z',
    });
    expect(result.summary.averageRpe).toBeNull();
    expect(result.intensityTrend).toEqual([
      { date: '2026-08-21', averageRpe: null },
    ]);

    const empty = await setup([], [[], [], []]).service.overview(7, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-21T23:59:59Z',
    });
    expect(empty.summary).toMatchObject({
      workouts: 0,
      activeMinutes: 0,
      workingSets: 0,
      volumeKg: 0,
      averageRpe: null,
    });
    expect(empty.activity).toEqual([
      {
        date: '2026-08-21',
        volumeKg: 0,
        plannedWorkouts: 0,
        completedWorkouts: 0,
      },
    ]);
  });

  it('uses active seconds, omits unrated sets from RPE distribution, and counts failures', async () => {
    const { service, builder } = setup([
      workout(
        5,
        '2026-08-21T23:59:59.999Z',
        [
          set(3, 60, 10, 8, true),
          set(3, 50, 10, 4, false),
          set(3, 20, 5, null, true),
        ],
        { durationSeconds: 600, volumeKg: 1350 },
      ),
    ]);

    const result = await service.intensity(7, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-21T23:59:59Z',
      timeZone: 'UTC',
    });
    expect(result).toEqual({
      averageRpe: 6,
      volumePerMinute: 135,
      totalVolumeKg: 1350,
      setsToFailure: 2,
      totalSets: 3,
      failurePercentage: 66.67,
      trend: [{ date: '2026-08-21', averageRpe: 6, volumeKg: 1350 }],
      rpeDistribution: [
        { range: '4-5', sets: 1, percentage: 50 },
        { range: '6-7', sets: 0, percentage: 0 },
        { range: '8-10', sets: 1, percentage: 50 },
      ],
    });
    const query = sqlAndParams(builder.where.mock.calls[0][0]);
    expect(query.params).toContain(7);
    expect(query.params).toContain('2026-08-21T00:00:00.000Z');
    expect(query.params).toContain('2026-08-21T23:59:59.001Z');
  });

  it('returns null ratios and an empty RPE distribution when the day has no measured data', async () => {
    const result = await setup().service.intensity(7, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-21T23:59:59Z',
    });
    expect(result).toEqual({
      averageRpe: null,
      volumePerMinute: null,
      totalVolumeKg: 0,
      setsToFailure: 0,
      totalSets: 0,
      failurePercentage: null,
      trend: [],
      rpeDistribution: [
        { range: '4-5', sets: 0, percentage: 0 },
        { range: '6-7', sets: 0, percentage: 0 },
        { range: '8-10', sets: 0, percentage: 0 },
      ],
    });
  });

  it('returns an empty muscle list and validates range ordering', async () => {
    const { service } = setup();
    await expect(
      service.muscleGroups(7, {
        from: '2026-08-22T00:00:00Z',
        to: '2026-08-21T00:00:00Z',
      }),
    ).rejects.toThrow('`from` must not be after `to`');
    await expect(
      service.muscleGroups(7, {
        from: '2026-08-21T00:00:00Z',
        to: '2026-08-22T00:00:00Z',
      }),
    ).resolves.toEqual({ muscleGroups: [] });
  });

  it('returns chronological set history for the requested exercise and user', async () => {
    const { service, builder } = setup([
      workout(19, '2026-08-21T10:00:00Z', [
        set(3, 90, 5, 7, true),
        set(4, 30, 8, 6, false),
      ]),
      workout(20, '2026-08-22T10:00:00Z', [set(3, 100, 4, null, false)]),
    ]);

    const result = await service.exerciseSets(7, 3, {
      from: '2026-08-21T00:00:00Z',
      to: '2026-08-22T23:59:59Z',
    });
    expect(result).toEqual({
      sets: [
        {
          date: '2026-08-21',
          finishedAt: '2026-08-21T10:00:00.000Z',
          setNumber: 1,
          workoutId: 19,
          weightKg: 90,
          reps: 5,
          rpe: 7,
          isFailure: true,
        },
        {
          date: '2026-08-22',
          finishedAt: '2026-08-22T10:00:00.000Z',
          setNumber: 1,
          workoutId: 20,
          weightKg: 100,
          reps: 4,
          isFailure: false,
        },
      ],
    });
    const query = sqlAndParams(builder.where.mock.calls[0][0]);
    expect(query.params).toContain(7);
    expect(query.params).toContain('2026-08-21T00:00:00.000Z');
    expect(query.params).toContain('2026-08-22T23:59:59.001Z');
  });

  it('counts late completions for adherence but not for the planned-day streak', () => {
    const assignments = [20, 21, 22, 23, 24].map((day, index) => ({
      scheduleId: index + 1,
      scheduledFor: `2026-08-${day}`,
    }));
    const completions = new Map<number, Date>([
      [1, new Date('2026-08-20T10:00:00Z')],
      [2, new Date('2026-08-22T10:00:00Z')],
      [3, new Date('2026-08-22T11:00:00Z')],
      [4, new Date('2026-08-23T10:00:00Z')],
    ]);

    expect(
      scheduleStats(assignments, completions, '2026-08-24', 'UTC'),
    ).toEqual({
      completedAssignments: 4,
      scheduledAssignments: 4,
      adherencePercent: 100,
      currentStreakDays: 2,
      longestStreakDays: 2,
    });
  });

  it('returns empty set history and rejects a nonpositive exercise ID', async () => {
    const { service } = setup();
    await expect(
      service.exerciseSets(7, 3, {
        from: '2026-08-21T00:00:00Z',
        to: '2026-08-21T23:59:59Z',
      }),
    ).resolves.toEqual({ sets: [] });
    await expect(
      service.exerciseSets(7, 0, {
        from: '2026-08-21T00:00:00Z',
        to: '2026-08-21T23:59:59Z',
      }),
    ).rejects.toThrow('exerciseId must be a positive integer');
  });
});
