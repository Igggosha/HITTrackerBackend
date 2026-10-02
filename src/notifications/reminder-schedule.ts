const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ReminderFrequency =
  'daily' | 'every_other_day' | 'weekly' | 'twice_weekly' | 'hourly';

export function getLocalReminderContext(now: Date, timeZone: string) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        minute: '2-digit',
        month: '2-digit',
        timeZone,
        weekday: 'short',
        year: 'numeric',
      })
        .formatToParts(now)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parts.hour,
      minute: parts.minute,
      time: `${parts.hour}:${parts.minute}`,
      weekday: weekdayNumbers[parts.weekday],
    };
  } catch {
    return null;
  }
}

export function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function getDueReminderKey(
  now: Date,
  timeZone: string,
  reminderTime: string,
  frequency: ReminderFrequency,
  reminderDays: number[],
) {
  const local = getLocalReminderContext(now, timeZone);
  if (!local) return null;
  const target = reminderTime.slice(0, 5);

  if (frequency === 'hourly') {
    const targetMinute = target.slice(3, 5);
    return local.minute >= targetMinute ? `${local.date}T${local.hour}` : null;
  }
  if (local.time < target) return null;
  if (
    (frequency === 'weekly' || frequency === 'twice_weekly') &&
    !reminderDays.includes(local.weekday)
  ) {
    return null;
  }
  if (frequency === 'every_other_day') {
    const dayNumber = Math.floor(
      Date.parse(`${local.date}T00:00:00Z`) / 86_400_000,
    );
    if (dayNumber % 2 !== 0) return null;
  }
  return local.date;
}
