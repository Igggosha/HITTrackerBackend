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

export function zonedLocalDateTimeToUtc(
  localDateTime: string,
  timeZone: string,
): Date | null {
  const match = localDateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/,
  );
  if (!match) return null;
  const desired = match.slice(1).map(Number);
  const desiredUtcLike = Date.UTC(
    desired[0],
    desired[1] - 1,
    desired[2],
    desired[3],
    desired[4],
  );
  const calendarCheck = new Date(desiredUtcLike);
  if (
    calendarCheck.getUTCFullYear() !== desired[0] ||
    calendarCheck.getUTCMonth() !== desired[1] - 1 ||
    calendarCheck.getUTCDate() !== desired[2]
  ) {
    return null;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    });
  } catch {
    return null;
  }

  let instant = desiredUtcLike;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    const adjustment = desiredUtcLike - represented;
    if (adjustment === 0) return new Date(instant);
    instant += adjustment;
  }
  return null;
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
