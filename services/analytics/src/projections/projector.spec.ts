import { Projector } from './projector';
import { InMemoryReadModelStore } from './testing/in-memory-store';
import {
  bodyMetricRecorded,
  source,
  userDeleted,
  workoutFinished,
} from './testing/fixtures';

const BENCH = 1;
const SQUAT = 2;

function setup() {
  const store = new InMemoryReadModelStore();
  return { store, projector: new Projector(store) };
}

// Week of Monday 2026-09-21 and of Monday 2026-09-28.
const w1 = () =>
  workoutFinished({
    workoutId: 101,
    finishedAt: '2026-09-22T18:00:00Z',
    durationSeconds: 3000,
    sets: [
      { exerciseId: BENCH, weight: 100, reps: 5 },
      { exerciseId: BENCH, weight: 90, reps: 8 },
      { exerciseId: SQUAT, weight: 140, reps: 3 },
    ],
  });
const w2 = () =>
  workoutFinished({
    workoutId: 102,
    finishedAt: '2026-09-23T18:00:00Z',
    durationSeconds: 2000,
    sets: [{ exerciseId: BENCH, weight: 95, reps: 5 }], // does not beat 100x5
  });
const w3 = () =>
  workoutFinished({
    workoutId: 103,
    finishedAt: '2026-09-28T07:00:00Z',
    durationSeconds: 1000,
    sets: [{ exerciseId: BENCH, weight: 105, reps: 3 }], // beats the heaviest set
  });

describe('Projector', () => {
  it('builds weekly volume from finished workouts', async () => {
    const { store, projector } = setup();
    for (const [i, event] of [w1(), w2(), w3()].entries())
      expect(await projector.apply(event, source(String(i)))).toBe('applied');

    expect(store.state.weeks.get('7:2026-09-21')).toEqual({
      userId: 7,
      isoWeekStart: '2026-09-21',
      workouts: 2,
      sets: 4,
      reps: 5 + 8 + 3 + 5,
      volumeKg: 500 + 720 + 420 + 475,
      durationSeconds: 5000,
    });
    expect(store.state.weeks.get('7:2026-09-28')).toMatchObject({
      workouts: 1,
      sets: 1,
      volumeKg: 315,
    });
  });

  it('updates personal records only when beaten', async () => {
    const { store, projector } = setup();
    await projector.apply(w1(), source('0'));
    const afterFirst = { ...store.state.records.get(`7:${BENCH}`)! };
    expect(afterFirst).toMatchObject({
      bestWeightKg: 100,
      bestRepsAtWeight: 5,
      workoutId: 101,
      bestE1rmKg: 116.67,
      writes: 1,
    });

    await projector.apply(w2(), source('1')); // 95x5: not beaten
    expect(store.state.records.get(`7:${BENCH}`)).toEqual(afterFirst);

    await projector.apply(w3(), source('2')); // 105x3: heavier
    expect(store.state.records.get(`7:${BENCH}`)).toMatchObject({
      bestWeightKg: 105,
      bestRepsAtWeight: 3,
      workoutId: 103,
      bestE1rmKg: 116.67, // 105x3 = 115.5 < 116.67: e1RM record still from w1
      bestE1rmWorkoutId: 101,
      writes: 2,
    });
    expect(store.state.records.get(`7:${SQUAT}`)).toMatchObject({
      bestWeightKg: 140,
      writes: 1,
    });
  });

  it('computes the streak and per-day exercise progress', async () => {
    const { store, projector } = setup();
    for (const event of [w1(), w2()]) await projector.apply(event, source());
    expect(store.state.streaks.get(7)).toEqual({
      currentStreakDays: 2,
      longestStreakDays: 2,
      lastWorkoutDate: '2026-09-23',
    });
    expect(store.state.progress.get(`7:${BENCH}:2026-09-22`)).toEqual({
      topSetWeightKg: 100,
      topSetReps: 5,
      e1rmKg: 116.67,
      volumeKg: 1220,
    });
  });

  it('is idempotent: the same event twice leaves the same state', async () => {
    const { store, projector } = setup();
    const event = w1();
    expect(await projector.apply(event, source('0'))).toBe('applied');
    const snapshot = structuredClone(store.state);
    expect(await projector.apply(event, source('0'))).toBe('duplicate');
    expect(store.state).toEqual(snapshot);
  });

  it('dedups the same workout re-published under another event id (backfill)', async () => {
    const { store, projector } = setup();
    const live = w1();
    await projector.apply(live, source('0'));
    const snapshot = structuredClone(store.state.weeks);
    const copy = { ...live, id: '00000000-0000-5000-8000-000000000001' };
    expect(await projector.apply(copy, source('9'))).toBe('duplicate');
    expect(store.state.weeks).toEqual(snapshot);
  });

  it('out-of-order finished events produce the same read models', async () => {
    const inOrder = setup();
    const shuffled = setup();
    const events = [w1(), w2(), w3()];
    for (const event of events) await inOrder.projector.apply(event, source());
    for (const event of [events[2], events[0], events[1]])
      await shuffled.projector.apply(event, source());

    const models = (s: InMemoryReadModelStore) => ({
      weeks: s.state.weeks,
      streaks: s.state.streaks,
      progress: s.state.progress,
      records: new Map(
        [...s.state.records].map(([k, { writes: _w, ...r }]) => [k, r]),
      ),
    });
    expect(models(shuffled.store)).toEqual(models(inOrder.store));
  });

  it('stores body metrics once per metric id', async () => {
    const { store, projector } = setup();
    const event = bodyMetricRecorded({
      metricId: 5,
      recordedAt: '2026-09-20T08:00:00Z',
    });
    expect(await projector.apply(event, source())).toBe('applied');
    expect(
      await projector.apply(
        { ...event, id: '00000000-0000-5000-8000-000000000002' },
        source(),
      ),
    ).toBe('duplicate');
    expect(store.state.bodyMetrics.size).toBe(1);
  });

  it('adds and removes scheduled assignments idempotently', async () => {
    const { store, projector } = setup();
    const scheduled = {
      id: '00000000-0000-5000-8000-000000000010',
      type: 'program.scheduled' as const,
      version: 1 as const,
      occurredAt: '2026-09-20T08:00:00Z',
      aggregateType: 'user',
      aggregateId: '7',
      payload: {
        userId: 7,
        programId: 3,
        scheduledFor: '2026-09-22',
        repeat: 'none' as const,
        repeatUntil: null,
        seriesId: null,
        scheduleIds: [41],
        assignments: [{ scheduleId: 41, scheduledFor: '2026-09-22' }],
      },
    };
    expect(await projector.apply(scheduled, source())).toBe('applied');
    expect(store.state.assignments.get(41)).toMatchObject({
      userId: 7,
      programId: 3,
      scheduledFor: '2026-09-22',
    });
    expect(
      await projector.apply(
        {
          id: '00000000-0000-5000-8000-000000000011',
          type: 'program.unscheduled',
          version: 1,
          occurredAt: '2026-09-20T09:00:00Z',
          aggregateType: 'user',
          aggregateId: '7',
          payload: { userId: 7, scheduleIds: [41] },
        },
        source(),
      ),
    ).toBe('applied');
    expect(store.state.assignments.has(41)).toBe(false);
  });

  it('user.deleted erases every row of that user only, and late events stay erased', async () => {
    const { store, projector } = setup();
    await projector.apply(w1(), source());
    await projector.apply(
      workoutFinished({
        workoutId: 900,
        userId: 8,
        finishedAt: '2026-09-22T10:00:00Z',
        sets: [{ exerciseId: BENCH, weight: 50, reps: 10 }],
      }),
      source(),
    );
    await projector.apply(
      bodyMetricRecorded({ metricId: 1, recordedAt: '2026-09-20T08:00:00Z' }),
      source(),
    );

    expect(
      await projector.apply(userDeleted(7, '2026-09-24T00:00:00Z'), source()),
    ).toBe('applied');

    const owned = (userId: number) =>
      [
        ...store.state.workouts.values(),
        ...store.state.sets.values(),
        ...store.state.weeks.values(),
        ...store.state.records.values(),
        ...store.state.bodyMetrics.values(),
      ].filter((row) => row.userId === userId).length;
    expect(owned(7)).toBe(0);
    expect(store.state.streaks.has(7)).toBe(false);
    expect(
      [...store.state.progress.keys()].some((k) => k.startsWith('7:')),
    ).toBe(false);
    expect(owned(8)).toBeGreaterThan(0);

    // A workout.finished from the other topic arriving after the erasure.
    expect(await projector.apply(w2(), source())).toBe('erased_user');
    expect(owned(7)).toBe(0);
  });

  it('ignores events without a read model (e.g. workout.cancelled)', async () => {
    const { store, projector } = setup();
    const result = await projector.apply(
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'workout.cancelled',
        version: 1,
        occurredAt: '2026-09-22T10:00:00Z',
        aggregateType: 'workout',
        aggregateId: '101',
        payload: {
          workoutId: 101,
          userId: 7,
          startedAt: '2026-09-22T09:00:00Z',
          cancelledAt: '2026-09-22T10:00:00Z',
          setCount: 0,
        },
      },
      source(),
    );
    expect(result).toBe('ignored');
    expect(store.state.workouts.size).toBe(0);
  });

  it('a failing transaction leaves no processed_events row behind', async () => {
    const { store, projector } = setup();
    store.failures.push(new Error('connection lost'));
    await expect(projector.apply(w1(), source())).rejects.toThrow(
      'connection lost',
    );
    expect(store.state.processed).toEqual([]);
    expect(await projector.apply(w1(), source())).toBe('applied');
  });
});
