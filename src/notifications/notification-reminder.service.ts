import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { primaryDb } from '../db/db';
import {
  notificationPreferences,
  userProgramSchedule,
  userProgramScheduleSeries,
} from '../db/schema';
import { weeklyDatesInRange } from '../workout-programs/schedule.utils';
import { NotificationsService } from './notifications.service';
import {
  addCalendarDays,
  getDueReminderKey,
  getLocalReminderContext,
  type ReminderFrequency,
} from './reminder-schedule';

@Injectable()
export class NotificationReminderService {
  constructor(private readonly notifications: NotificationsService) {}

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
    await this.materializeWeeklyAssignments(
      preference.userId,
      local.date,
      tomorrow,
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

  private async materializeWeeklyAssignments(
    userId: number,
    from: string,
    to: string,
  ) {
    const series = await primaryDb
      .select()
      .from(userProgramScheduleSeries)
      .where(
        and(
          eq(userProgramScheduleSeries.userId, userId),
          lte(userProgramScheduleSeries.startsOn, to),
          or(
            isNull(userProgramScheduleSeries.endsOn),
            gte(userProgramScheduleSeries.endsOn, from),
          ),
        ),
      );
    const assignments = series.flatMap((item) =>
      weeklyDatesInRange(
        item.startsOn,
        from,
        item.endsOn && item.endsOn < to ? item.endsOn : to,
      ).map((scheduledFor) => ({
        userId,
        programId: item.programId,
        scheduledFor,
        seriesId: item.id,
      })),
    );
    if (assignments.length) {
      await primaryDb
        .insert(userProgramSchedule)
        .values(assignments)
        .onConflictDoNothing();
    }
  }
}
