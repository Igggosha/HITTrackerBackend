import { NotFoundException } from '@nestjs/common';
import { db, primaryDb } from '../db/db';
import { _resetReadConsistencyForTests } from '../db/read-consistency';
import {
  outboxEvents,
  sets,
  userProgramSchedule,
  workouts,
} from '../db/schema';
import type { WorkoutFinishedV1 } from '../outbox/events';
import { OutboxService } from '../outbox/outbox.service';
import {
  calledWith,
  fakeOf,
  insertedValues,
  renderSql,
  type RecordedQuery,
} from '../outbox/testing/fake-database';
import { WorkoutsService } from './workouts.service';
import type { WorkoutHistoryDatesDto } from './dto/workout.dto';

// `db` (replica-routed) and `primaryDb` are separate fakes so the routing
// tests can tell which one a read reached; transactions run on `db`.
jest.mock('../db/db', () => {
  const { FakeDatabase } = jest.requireActual<
    typeof import('../outbox/testing/fake-database')
  >('../outbox/testing/fake-database');
  return { db: new FakeDatabase().db, primaryDb: new FakeDatabase().db };
});

const fake = fakeOf(db);
const primaryFake = fakeOf(primaryDb);

const startedAt = new Date(Date.now() - 30 * 60 * 1000);
const workoutRow = (overrides: Partial<typeof workouts.$inferSelect> = {}) => ({
  id: 7,
  userId: 1,
  programContentId: null,
  type: 'HIT Session',
  status: 'active',
  pausedAt: null,
  pausedSeconds: 60,
  lastActivityAt: new Date(),
  notes: null,
  durationSeconds: null,
  finishedAt: null,
  scheduleId: null,
  historySnapshot: null,
  createdAt: startedAt,
  ...overrides,
});

const locksRow = (query: RecordedQuery | undefined) =>
  calledWith(query, 'for').some(({ args }) => args[0] === 'update');

const outboxPayloads = () => insertedValues(fake, outboxEvents);

describe('WorkoutsService transactions', () => {
  const service = new WorkoutsService(new OutboxService());

  beforeEach(() => {
    fake.reset();
    primaryFake.reset();
    _resetReadConsistencyForTests();
  });

  describe('startWorkout', () => {
    it('serializes starts per user and returns the open workout on a retry', async () => {
      fake.returns('select', workouts, [workoutRow()]);

      const result = await service.startWorkout(1, 'user', {});

      expect(result.message).toBe('Active workout already in progress');
      expect(result.workout.id).toBe(7);
      const [lock] = fake.find('execute');
      expect(lock.scope).toBe('tx');
      expect(renderSql(lock.args[0])).toContain('pg_advisory_xact_lock');
      expect(fake.find('insert')).toHaveLength(0);
      // The advisory lock is taken before the open-workout check.
      expect(fake.queries.indexOf(lock)).toBeLessThan(
        fake.queries.indexOf(fake.find('select', workouts)[0]),
      );
    });

    it('creates the workout and its workout.started event in one transaction', async () => {
      const created = workoutRow({
        id: 9,
        createdAt: new Date('2026-09-27T10:00:00Z'),
      });
      fake.returns('insert', workouts, [created]);

      const result = await service.startWorkout(1, 'user', {});

      expect(result.message).toBe('Workout started');
      const [workoutInsert] = fake.committed('insert', workouts);
      const [eventInsert] = fake.committed('insert', outboxEvents);
      expect(eventInsert.transactionId).toBe(workoutInsert.transactionId);
      expect(outboxPayloads()[0]).toMatchObject({
        eventType: 'workout.started',
        aggregateType: 'workout',
        aggregateId: '9',
        payload: {
          workoutId: 9,
          userId: 1,
          startedAt: '2026-09-27T10:00:00.000Z',
        },
      });
    });

    it('does not keep the workout when its event cannot be stored', async () => {
      fake.returns('insert', workouts, [workoutRow({ id: 9 })]);
      fake.fails('insert', outboxEvents, new Error('disk full'));

      await expect(service.startWorkout(1, 'user', {})).rejects.toThrow(
        'disk full',
      );
      expect(fake.committed('insert', workouts)).toHaveLength(0);
    });
  });

  describe('finishWorkout', () => {
    it('locks the workout and emits workout.finished with the performed sets', async () => {
      fake.returns('select', workouts, [workoutRow({ scheduleId: 4 })]);
      fake.returns('update', workouts, [workoutRow({ status: 'completed' })]);
      fake.returns('select', sets, [
        {
          set: {
            id: 1,
            workoutId: 7,
            exerciseId: 3,
            weight: 100,
            reps: 5,
            rpe: 8,
            isFailure: false,
            isDropSet: false,
          },
          exerciseName: 'Barbell bench press',
          muscleId: 1,
          muscleCommonName: 'Chest',
        },
        {
          set: {
            id: 2,
            workoutId: 7,
            exerciseId: 5,
            weight: 40,
            reps: 10,
            rpe: null,
            isFailure: true,
            isDropSet: true,
          },
          exerciseName: 'Lat pulldown',
          muscleId: 2,
          muscleCommonName: 'Lats',
        },
      ]);
      fake.returns('select', userProgramSchedule, [
        { scheduledFor: '2026-10-10' },
      ]);

      const result = await service.finishWorkout(7, 1, { notes: 'good' });

      expect(result.message).toBe('Workout finished successfully');
      expect(locksRow(fake.find('select', workouts)[0])).toBe(true);
      expect(fake.committed('update', userProgramSchedule)).toHaveLength(1);
      const [event] = outboxPayloads();
      expect(event).toMatchObject({
        eventType: 'workout.finished',
        aggregateId: '7',
        payload: {
          workoutId: 7,
          userId: 1,
          scheduleId: 4,
          scheduledFor: '2026-10-10',
          setCount: 2,
          exerciseIds: [3, 5],
          totalVolume: 900,
          sets: [
            {
              setId: 1,
              exerciseId: 3,
              weight: 100,
              reps: 5,
              volume: 500,
              isFailure: false,
              isDropSet: false,
            },
            {
              setId: 2,
              exerciseId: 5,
              weight: 40,
              reps: 10,
              volume: 400,
              isFailure: true,
              isDropSet: true,
            },
          ],
        },
      });
      const payload = event.payload as WorkoutFinishedV1;
      expect(payload.durationSeconds).toBeGreaterThan(0);
      expect(payload.pausedSeconds).toBe(60);
    });

    it('is idempotent: a second finish returns the stored result and emits nothing', async () => {
      const finished = workoutRow({
        status: 'completed',
        finishedAt: new Date(),
        durationSeconds: 1200,
      });
      fake.returns('select', workouts, [finished]);

      await expect(service.finishWorkout(7, 1, {})).resolves.toEqual({
        message: 'Workout was already finished',
        workout: finished,
      });
      expect(fake.find('update')).toHaveLength(0);
      expect(fake.find('insert')).toHaveLength(0);
    });

    it('never turns a cancelled workout into completed history', async () => {
      fake.returns('select', workouts, [workoutRow({ status: 'cancelled' })]);

      await expect(service.finishWorkout(7, 1, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fake.find('update')).toHaveLength(0);
    });

    it('rolls the finish back when the event cannot be stored', async () => {
      fake.returns('select', workouts, [workoutRow()]);
      fake.returns('update', workouts, [workoutRow({ status: 'completed' })]);
      fake.fails('insert', outboxEvents, new Error('outbox unavailable'));

      await expect(service.finishWorkout(7, 1, {})).rejects.toThrow(
        'outbox unavailable',
      );
      expect(fake.find('update', workouts)).toHaveLength(1);
      expect(fake.committed('update', workouts)).toHaveLength(0);
    });
  });

  describe('cancelWorkout', () => {
    it('cancels with one conditional update and emits workout.cancelled', async () => {
      fake.returns('update', workouts, [workoutRow({ status: 'cancelled' })]);
      fake.returns('select', sets, [{ setCount: 3 }]);

      await service.cancelWorkout(7, 1);

      const [update] = fake.find('update', workouts);
      const where = renderSql(calledWith(update, 'where')[0].args[0]);
      expect(where).toContain('"finished_at" is null');
      expect(where).toContain('"status" in');
      expect(outboxPayloads()[0]).toMatchObject({
        eventType: 'workout.cancelled',
        payload: { workoutId: 7, userId: 1, setCount: 3 },
      });
    });

    it('rejects a workout that a concurrent finish already completed', async () => {
      // The conditional update matched no open row.
      await expect(service.cancelWorkout(7, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(fake.find('insert', outboxEvents)).toHaveLength(0);
    });
  });

  describe('sets', () => {
    it('locks the open workout before recording a set', async () => {
      fake.returns('select', workouts, [workoutRow()]);
      fake.returns('insert', sets, [{ id: 11 }]);
      fake.returns('update', workouts, [workoutRow()]);

      await service.recordSet(7, 1, {
        exerciseId: 3,
        weight: 50,
        reps: 10,
        rpe: 8,
      });

      const [lock] = fake.find('select', workouts);
      expect(locksRow(lock)).toBe(true);
      expect(renderSql(calledWith(lock, 'where')[0].args[0])).toContain(
        '"finished_at" is null',
      );
      expect(fake.queries.indexOf(lock)).toBeLessThan(
        fake.queries.indexOf(fake.find('insert', sets)[0]),
      );
    });

    it('refuses a set for a workout finished before the lock was granted', async () => {
      await expect(
        service.recordSet(7, 1, {
          exerciseId: 3,
          weight: 50,
          reps: 10,
          rpe: 8,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fake.find('insert', sets)).toHaveLength(0);
    });

    it('refuses to edit a set once the workout is no longer open', async () => {
      await expect(
        service.updateSet(7, 11, 1, { weight: 50, reps: 10, rpe: 8 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(locksRow(fake.find('select', workouts)[0])).toBe(true);
      expect(fake.find('update', sets)).toHaveLength(0);
    });
  });

  it('togglePause works on the locked open row only', async () => {
    fake.returns('select', workouts, [workoutRow()]);
    fake.returns('update', workouts, [workoutRow({ status: 'paused' })]);

    await service.togglePause(7, 1);

    expect(locksRow(fake.find('select', workouts)[0])).toBe(true);
    await expect(service.togglePause(8, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('WorkoutsService replica/primary read routing', () => {
  const service = new WorkoutsService(new OutboxService());
  const dto: WorkoutHistoryDatesDto = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-02-01T00:00:00.000Z',
  };

  // cancelWorkout: one conditional update inside the transaction, then the
  // set count and the outbox event; the user is marked only after commit.
  const cancelFor = async (workoutId: number, userId: number) => {
    fake.returns('update', workouts, [
      workoutRow({ id: workoutId, userId, status: 'cancelled' }),
    ]);
    fake.returns('select', sets, [{ setCount: 0 }]);
    await service.cancelWorkout(workoutId, userId);
    fake.reset();
    primaryFake.reset();
  };

  beforeEach(() => {
    fake.reset();
    primaryFake.reset();
    _resetReadConsistencyForTests();
  });

  it('routes a pure browsing history read to the replica when the user has not written recently', async () => {
    fake.returns('select', workouts, [
      { finishedAt: new Date('2026-01-15T00:00:00.000Z') },
    ]);

    const dates = await service.getHistoryDates(7, dto);

    expect(dates).toEqual(['2026-01-15T00:00:00.000Z']);
    expect(fake.find('select')).toHaveLength(1);
    expect(primaryFake.queries).toHaveLength(0);
  });

  it('routes the same read to the primary immediately after that user writes', async () => {
    await cancelFor(1, 9);

    await service.getHistoryDates(9, dto);

    expect(primaryFake.find('select')).toHaveLength(1);
    expect(fake.find('select')).toHaveLength(0);
  });

  it('falls back to the replica again once a different user reads', async () => {
    await cancelFor(2, 11);

    await service.getHistoryDates(12, dto);

    expect(fake.find('select')).toHaveLength(1);
    expect(primaryFake.queries).toHaveLength(0);
  });

  it('does not mark a write whose transaction rolled back', async () => {
    fake.returns('update', workouts, [workoutRow({ userId: 13 })]);
    fake.returns('select', sets, [{ setCount: 0 }]);
    fake.fails('insert', outboxEvents, new Error('outbox unavailable'));
    await expect(service.cancelWorkout(7, 13)).rejects.toThrow(
      'outbox unavailable',
    );
    fake.reset();

    await service.getHistoryDates(13, dto);

    expect(fake.find('select')).toHaveLength(1);
    expect(primaryFake.queries).toHaveLength(0);
  });
});
