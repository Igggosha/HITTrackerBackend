// EN: Verifies reminder materialization commits schedule events with newly inserted slots.
// UK: Перевіряє, що нагадування зберігає події розкладу разом із новими записами.

import { primaryDb } from '../db/db';
import {
  notificationPreferences,
  outboxEvents,
  userProgramSchedule,
  userProgramScheduleSeries,
} from '../db/schema';
import { OutboxService } from '../outbox/outbox.service';
import {
  calledWith,
  fakeOf,
  insertedValues,
} from '../outbox/testing/fake-database';
import type { NotificationsService } from './notifications.service';
import { NotificationReminderService } from './notification-reminder.service';

jest.mock('../db/db', () => {
  const { FakeDatabase } = jest.requireActual<
    typeof import('../outbox/testing/fake-database')
  >('../outbox/testing/fake-database');
  const db = new FakeDatabase().db;
  return { db, primaryDb: db };
});

const fake = fakeOf(primaryDb);

it('emits program.scheduled for a slot first created by the reminder path', async () => {
  fake.reset();
  fake.returns('select', notificationPreferences, [
    {
      userId: 7,
      timeZone: 'UTC',
      workoutRemindersEnabled: true,
      workoutReminderFrequency: 'scheduled',
      workoutReminderTime: '09:00:00',
      workoutReminderDays: [],
      measurementRemindersEnabled: false,
    },
  ]);
  fake.returns('select', userProgramScheduleSeries, [
    {
      id: 9,
      userId: 7,
      programId: 4,
      startsOn: '2026-10-24',
      endsOn: null,
    },
  ]);
  fake.returns('insert', userProgramSchedule, [
    {
      id: 21,
      userId: 7,
      programId: 4,
      scheduledFor: '2026-10-24',
      seriesId: 9,
    },
  ]);
  fake.returns('select', userProgramSchedule, [{ scheduledFor: '2026-10-24' }]);
  const notifications = {
    createReminder: jest.fn().mockResolvedValue({ notificationId: 1 }),
  };
  const service = new NotificationReminderService(
    notifications as unknown as NotificationsService,
    new OutboxService(),
  );

  await service.createDue(new Date('2026-10-24T10:00:00Z'));

  const [slot] = fake.committed('insert', userProgramSchedule);
  const [event] = fake.committed('insert', outboxEvents);
  expect(event.transactionId).toBe(slot.transactionId);
  expect(insertedValues(fake, outboxEvents)[0]).toMatchObject({
    eventType: 'program.scheduled',
    payload: { userId: 7, scheduleIds: [21] },
  });
  expect(
    calledWith(
      fake.find('insert', userProgramSchedule)[0],
      'onConflictDoNothing',
    ),
  ).toHaveLength(1);
});

it('catches up a series from its start, then limits recurring scans to nearby days', async () => {
  const service = new NotificationReminderService(
    { createReminder: jest.fn() } as unknown as NotificationsService,
    new OutboxService(),
  );
  const series = {
    id: 9,
    userId: 7,
    programId: 4,
    startsOn: '2026-10-03',
    endsOn: null,
  };
  const scan = async (fullCatchUp: boolean) => {
    fake.reset();
    fake.returns('select', userProgramScheduleSeries, [{ userId: 7 }]);
    fake.returns('select', userProgramScheduleSeries, [series]);
    await service.materializeDueAssignments(
      new Date('2026-10-24T10:00:00Z'),
      fullCatchUp,
    );
    return calledWith(fake.find('insert', userProgramSchedule)[0], 'values')[0]
      .args[0] as { scheduledFor: string }[];
  };

  expect((await scan(true)).map((item) => item.scheduledFor)).toEqual([
    '2026-10-03',
    '2026-10-10',
    '2026-10-17',
    '2026-10-24',
  ]);
  expect((await scan(false)).map((item) => item.scheduledFor)).toEqual([
    '2026-10-24',
  ]);
});
