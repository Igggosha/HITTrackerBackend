import {
  aggregateWeek,
  computeDayProgress,
  computePersonalRecord,
  computeStreak,
  effectiveCurrentStreak,
  epley1rm,
  isoWeekStart,
  utcDate,
} from './calculations';

const set = (
  workoutId: number,
  weightKg: number,
  reps: number,
  finishedAt: string,
) => ({
  workoutId,
  exerciseId: 1,
  weightKg,
  reps,
  finishedAt: new Date(finishedAt),
});

describe('calculations', () => {
  it('Epley e1RM = w * (1 + reps / 30), rounded to 2 decimals', () => {
    expect(epley1rm(100, 5)).toBe(116.67);
    expect(epley1rm(100, 30)).toBe(200);
    expect(epley1rm(0, 12)).toBe(0);
  });

  describe('isoWeekStart (UTC Monday)', () => {
    it.each([
      ['2026-09-28T00:00:00Z', '2026-09-28'], // Monday 00:00 starts the week
      ['2026-09-27T23:59:59Z', '2026-09-21'], // Sunday belongs to the previous week
      ['2026-10-04T12:00:00Z', '2026-09-28'],
      ['2026-01-01T10:00:00Z', '2025-12-29'], // across a year boundary
    ])('%s -> %s', (instant, monday) => {
      expect(isoWeekStart(new Date(instant))).toBe(monday);
    });

    it('uses UTC, not the local offset of the timestamp', () => {
      // 00:30 on Monday in UTC+2 is still Sunday in UTC.
      expect(isoWeekStart(new Date('2026-09-28T00:30:00+02:00'))).toBe(
        '2026-09-21',
      );
    });
  });

  it('aggregates a week from workout totals', () => {
    expect(
      aggregateWeek([
        { setCount: 3, reps: 30, volumeKg: 1500.25, durationSeconds: 1800 },
        { setCount: 2, reps: 10, volumeKg: 1000.1, durationSeconds: 1200 },
      ]),
    ).toEqual({
      workouts: 2,
      sets: 5,
      reps: 40,
      volumeKg: 2500.35,
      durationSeconds: 3000,
    });
    expect(aggregateWeek([])).toEqual({
      workouts: 0,
      sets: 0,
      reps: 0,
      volumeKg: 0,
      durationSeconds: 0,
    });
  });

  describe('streaks', () => {
    it('counts several workouts on the same day once', () => {
      expect(computeStreak(['2026-09-28', '2026-09-28'])).toEqual({
        currentStreakDays: 1,
        longestStreakDays: 1,
        lastWorkoutDate: '2026-09-28',
      });
    });

    it('a gap day restarts the current streak but keeps the longest', () => {
      expect(
        computeStreak([
          '2026-09-20',
          '2026-09-21',
          '2026-09-22',
          '2026-09-24', // gap on the 23rd
          '2026-09-25',
        ]),
      ).toEqual({
        currentStreakDays: 2,
        longestStreakDays: 3,
        lastWorkoutDate: '2026-09-25',
      });
    });

    it('23:59Z and 00:01Z the next day are two consecutive UTC days', () => {
      const dates = ['2026-09-27T23:59:00Z', '2026-09-28T00:01:00Z'].map((d) =>
        utcDate(new Date(d)),
      );
      expect(computeStreak(dates)?.currentStreakDays).toBe(2);
    });

    it('is order independent', () => {
      expect(computeStreak(['2026-09-22', '2026-09-20', '2026-09-21'])).toEqual(
        computeStreak(['2026-09-20', '2026-09-21', '2026-09-22']),
      );
    });

    it('returns null without workouts', () => {
      expect(computeStreak([])).toBeNull();
    });

    it('reports the current streak only while it is alive (today or yesterday, UTC)', () => {
      const streak = { currentStreakDays: 4, lastWorkoutDate: '2026-09-27' };
      expect(
        effectiveCurrentStreak(streak, new Date('2026-09-27T20:00:00Z')),
      ).toBe(4);
      expect(
        effectiveCurrentStreak(streak, new Date('2026-09-28T23:59:59Z')),
      ).toBe(4);
      expect(
        effectiveCurrentStreak(streak, new Date('2026-09-29T00:00:00Z')),
      ).toBe(0);
    });
  });

  describe('personal records', () => {
    it('picks the heaviest set and the best e1RM independently', () => {
      const record = computePersonalRecord(1, [
        set(1, 100, 3, '2026-09-01T10:00:00Z'), // heaviest, e1RM 110
        set(2, 90, 10, '2026-09-02T10:00:00Z'), // e1RM 120
      ]);
      expect(record).toEqual({
        exerciseId: 1,
        bestWeightKg: 100,
        bestRepsAtWeight: 3,
        achievedAt: new Date('2026-09-01T10:00:00Z'),
        workoutId: 1,
        bestE1rmKg: 120,
        bestE1rmAchievedAt: new Date('2026-09-02T10:00:00Z'),
        bestE1rmWorkoutId: 2,
      });
    });

    it('is not "beaten" by an equal later set: the earliest achievement stays', () => {
      const first = set(1, 100, 5, '2026-09-01T10:00:00Z');
      const equal = set(2, 100, 5, '2026-09-08T10:00:00Z');
      const record = computePersonalRecord(1, [equal, first]);
      expect(record?.workoutId).toBe(1);
      expect(record?.bestE1rmWorkoutId).toBe(1);
    });

    it('more reps at the same weight beats the record', () => {
      const record = computePersonalRecord(1, [
        set(1, 100, 5, '2026-09-01T10:00:00Z'),
        set(2, 100, 6, '2026-09-08T10:00:00Z'),
      ]);
      expect(record).toMatchObject({ bestRepsAtWeight: 6, workoutId: 2 });
    });

    it('returns null without sets', () => {
      expect(computePersonalRecord(1, [])).toBeNull();
    });
  });

  it('day progress: top set by weight then reps, max e1RM, volume', () => {
    expect(
      computeDayProgress([
        { weightKg: 80, reps: 12 },
        { weightKg: 100, reps: 3 },
        { weightKg: 100, reps: 5 },
      ]),
    ).toEqual({
      topSetWeightKg: 100,
      topSetReps: 5,
      e1rmKg: 116.67,
      volumeKg: 80 * 12 + 300 + 500,
    });
    expect(computeDayProgress([])).toBeNull();
  });
});
