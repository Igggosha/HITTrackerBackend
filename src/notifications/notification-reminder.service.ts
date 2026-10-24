// EN: Materializes preference-aware body-metric and scheduled-workout reminders for each user's local date and time zone.
// UK: Створює нагадування про показники тіла та заплановані тренування з урахуванням налаштувань, локальної дати й часового поясу користувача.

import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { primaryDb } from '../db/db';
import {
  notificationPreferences,
  userProgramSchedule,
  userProgramScheduleSeries,
} from '../db/schema';
import { materializeWeeklyAssignments } from '../workout-programs/materialize-weekly-assignments';
import { OutboxService } from '../outbox/outbox.service';
import { NotificationsService } from './notifications.service';
import {
  addCalendarDays,
  getDueReminderKey,
  getLocalReminderContext,
  type ReminderFrequency,
} from './reminder-schedule';

@Injectable()
export class NotificationReminderService {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  // EN: Catch up all retained series at startup, then scan only nearby UTC dates.
  // UK: Під час запуску надолужує всі збережені серії, а потім перевіряє лише найближчі дати UTC.
  async materializeDueAssignments(now = new Date(), fullCatchUp = false) {
    const today = now.toISOString().slice(0, 10);
    const from = fullCatchUp ? null : addCalendarDays(today, -1);
    const to = addCalendarDays(today, 1);
    const series = await primaryDb
      .select({ userId: userProgramScheduleSeries.userId })
      .from(userProgramScheduleSeries)
      .where(
        and(
          lte(userProgramScheduleSeries.startsOn, to),
          from
            ? or(
                isNull(userProgramScheduleSeries.endsOn),
                gte(userProgramScheduleSeries.endsOn, from),
              )
            : undefined,
        ),
      );
    for (const userId of new Set(series.map((item) => item.userId))) {
      await primaryDb.transaction((tx) =>
        materializeWeeklyAssignments(tx, this.outbox, userId, from, to),
      );
    }
  }

  async createDue(now = new Date()) {
    const preferences = await primaryDb
      .select({
        measurementRemindersEnabled:
          notificationPreferences.measurementRemindersEnabled,
        measurementReminderDays:
          notificationPreferences.measurementReminderDays,
        measurementReminderFrequency:
          notificationPreferences.measurementReminderFrequency,
        measurementReminderTime:
          notificationPreferences.measurementReminderTime,
        timeZone: notificationPreferences.timeZone,
        userId: notificationPreferences.userId,
        workoutRemindersEnabled:
          notificationPreferences.workoutRemindersEnabled,
        workoutReminderDays: notificationPreferences.workoutReminderDays,
        workoutReminderFrequency:
          notificationPreferences.workoutReminderFrequency,
        workoutReminderTime: notificationPreferences.workoutReminderTime,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.pushEnabled, true),
          isNotNull(notificationPreferences.timeZone),
          or(
            eq(notificationPreferences.workoutRemindersEnabled, true),
            eq(notificationPreferences.measurementRemindersEnabled, true),
          ),
        ),
      );

    let created = 0;
    for (const preference of preferences) {
      if (preference.workoutRemindersEnabled) {
        created += await this.createWorkoutReminders(preference, now);
      }
      if (preference.measurementRemindersEnabled) {
        const key = getDueReminderKey(
          now,
          preference.timeZone!,
          preference.measurementReminderTime,
          preference.measurementReminderFrequency,
          preference.measurementReminderDays,
        );
        if (key) {
          const result = await this.notifications.createReminder(
            preference.userId,
            'measurements',
            'Measurement reminder',
            'Record your body measurements to keep analytics up to date.',
            key,
          );
          if (result.notificationId) created += 1;
        }
      }
    }
    return { checked: preferences.length, created };
  }

  private async createWorkoutReminders(
    preference: {
      userId: number;
      timeZone: string | null;
      workoutReminderTime: string;
      workoutReminderFrequency: 'scheduled' | ReminderFrequency;
      workoutReminderDays: number[];
    },
    now: Date,
  ) {
    if (preference.workoutReminderFrequency !== 'scheduled') {
      const key = getDueReminderKey(
        now,
        preference.timeZone!,
        preference.workoutReminderTime,
        preference.workoutReminderFrequency,
        preference.workoutReminderDays,
      );
      if (!key) return 0;
      const result = await this.notifications.createReminder(
        preference.userId,
        'workout',
        'Workout reminder',
        'It is time to train.',
        key,
      );
      return result.notificationId ? 1 : 0;
    }

    const due = getDueReminderKey(
      now,
      preference.timeZone!,
      preference.workoutReminderTime,
      'daily',
      preference.workoutReminderDays,
    );
    const local = getLocalReminderContext(now, preference.timeZone!);
    if (!due || !local) return 0;

    const tomorrow = addCalendarDays(local.date, 1);
    await primaryDb.transaction((tx) =>
      materializeWeeklyAssignments(
        tx,
        this.outbox,
        preference.userId,
        local.date,
        tomorrow,
      ),
    );
    const rows = await primaryDb
      .select({ scheduledFor: userProgramSchedule.scheduledFor })
      .from(userProgramSchedule)
      .where(
        and(
          eq(userProgramSchedule.userId, preference.userId),
          eq(userProgramSchedule.status, 'planned'),
          inArray(userProgramSchedule.scheduledFor, [local.date, tomorrow]),
        ),
      );

    let created = 0;
    for (const scheduledFor of new Set(rows.map((row) => row.scheduledFor))) {
      const isToday = scheduledFor === local.date;
      const result = await this.notifications.createReminder(
        preference.userId,
        'workout',
        isToday ? 'Workout scheduled today' : 'Workout scheduled tomorrow',
        isToday
          ? 'Your planned workout is scheduled for today.'
          : 'Your planned workout is coming up tomorrow.',
        `scheduled:${scheduledFor}:${isToday ? 'today' : 'day-before'}`,
      );
      if (result.notificationId) created += 1;
    }
    return created;
  }
}
