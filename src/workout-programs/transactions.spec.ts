import { ConflictException } from '@nestjs/common';
import { db } from '../db/db';
import type { StorageService } from '../storage/storage.service';
import {
  outboxEvents,
  userProgramSchedule,
  userProgramScheduleSeries,
  workoutPrograms,
} from '../db/schema';
import { OutboxService } from '../outbox/outbox.service';
import {
  calledWith,
  fakeOf,
  insertedValues,
} from '../outbox/testing/fake-database';
import { WorkoutProgramsService } from './workout-programs.service';

jest.mock('../db/db', () =>
  jest
    .requireActual<typeof import('../outbox/testing/fake-database')>(
      '../outbox/testing/fake-database',
    )
    .fakeDbModule(),
);

const fake = fakeOf(db);
const storage = {
  getUrl: jest.fn().mockResolvedValue(null),
  getUrls: jest.fn().mockResolvedValue([]),
  remove: jest.fn(),
};

const events = () => insertedValues(fake, outboxEvents);

describe('WorkoutProgramsService transactions', () => {
  const service = new WorkoutProgramsService(
    storage as unknown as StorageService,
    new OutboxService(),
  );

  beforeEach(() => {
    fake.reset();
    jest
      .spyOn(service, 'getProgramById')
      .mockResolvedValue(
        {} as Awaited<ReturnType<WorkoutProgramsService['getProgramById']>>,
      );
  });

  it('stores a one-off assignment and program.scheduled together', async () => {
    fake.returns('insert', userProgramSchedule, [{ id: 21 }]);

    await expect(
      service.scheduleProgram(1, 'user', {
        programId: 4,
        scheduledFor: '2026-10-01',
      }),
    ).resolves.toEqual([{ id: 21 }]);

    const [assignment] = fake.committed('insert', userProgramSchedule);
    const [event] = fake.committed('insert', outboxEvents);
    expect(event.transactionId).toBe(assignment.transactionId);
    expect(events()[0]).toMatchObject({
      eventType: 'program.scheduled',
      aggregateType: 'user',
      aggregateId: '1',
      payload: {
        userId: 1,
        programId: 4,
        scheduledFor: '2026-10-01',
        repeat: 'none',
        seriesId: null,
        scheduleIds: [21],
      },
    });
  });

  it('treats a retried one-off assignment as a no-op without a second event', async () => {
    // ON CONFLICT DO NOTHING on (user, date, program) returned no row.
    await expect(
      service.scheduleProgram(1, 'user', {
        programId: 4,
        scheduledFor: '2026-10-01',
      }),
    ).resolves.toEqual([]);
    expect(fake.find('insert', outboxEvents)).toHaveLength(0);
  });

  it('emits one event for a weekly series', async () => {
    fake.returns('insert', userProgramScheduleSeries, [{ id: 8 }]);
    fake.returns('insert', userProgramSchedule, [{ id: 22 }]);

    await service.scheduleProgram(1, 'user', {
      programId: 4,
      scheduledFor: '2026-10-01',
      repeat: 'weekly',
      repeatUntil: '2026-12-01',
    });

    expect(events()).toHaveLength(1);
    expect(events()[0].payload).toMatchObject({
      repeat: 'weekly',
      repeatUntil: '2026-12-01',
      seriesId: 8,
      scheduleIds: [22],
    });
  });

  it('stores an unschedule event in the same transaction as the removal', async () => {
    fake.returns('select', userProgramSchedule, [{ seriesId: null }]);

    await service.removeScheduledProgram(1, 21);

    const [removal] = fake.committed('delete', userProgramSchedule);
    const [event] = fake.committed('insert', outboxEvents);
    expect(event.transactionId).toBe(removal.transactionId);
    expect(events()[0]).toMatchObject({
      eventType: 'program.unscheduled',
      aggregateType: 'user',
      aggregateId: '1',
      payload: { userId: 1, scheduleIds: [21] },
    });
  });

  it('refuses a second concurrent revision of the same official program', async () => {
    const program = {
      id: 3,
      name: 'Official',
      description: null,
      videoUrl: null,
      imageKey: null,
      isPersonal: false,
      isActive: true,
      createdById: 9,
      shareToken: null,
      sourceProgramId: null,
      createdAt: new Date(),
    };
    fake.returns('select', workoutPrograms, [program]);
    // By the time this request holds the row lock, another moderator's
    // revision has already retired the program.
    fake.returns('select', workoutPrograms, [{ ...program, isActive: false }]);

    await expect(
      service.updateProgram(1, 'moderator', 3, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const lock = fake.find('select', workoutPrograms)[1];
    expect(calledWith(lock, 'for')[0].args).toEqual(['update']);
    expect(fake.find('insert', workoutPrograms)).toHaveLength(0);
  });
});
