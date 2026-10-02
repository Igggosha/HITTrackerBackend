import {
  addCalendarDays,
  getDueReminderKey,
  getLocalReminderContext,
  zonedLocalDateTimeToUtc,
} from './reminder-schedule';

describe('notification reminder schedule', () => {
  const mondayAt1830Utc = new Date('2026-10-05T18:30:00Z');

  it('supports daily, weekly, twice-weekly and hourly cadence', () => {
    expect(
      getDueReminderKey(mondayAt1830Utc, 'UTC', '18:00', 'daily', [2]),
    ).toBe('2026-10-05');
    expect(
      getDueReminderKey(mondayAt1830Utc, 'UTC', '18:00', 'weekly', [1]),
    ).toBe('2026-10-05');
    expect(
      getDueReminderKey(
        mondayAt1830Utc,
        'UTC',
        '18:00',
        'twice_weekly',
        [1, 4],
      ),
    ).toBe('2026-10-05');
    expect(
      getDueReminderKey(mondayAt1830Utc, 'UTC', '00:15', 'hourly', [1]),
    ).toBe('2026-10-05T18');
  });

  it('honors time, weekday, alternating days and time zone', () => {
    expect(
      getDueReminderKey(mondayAt1830Utc, 'UTC', '19:00', 'daily', [1]),
    ).toBeNull();
    expect(
      getDueReminderKey(mondayAt1830Utc, 'UTC', '18:00', 'weekly', [2]),
    ).toBeNull();
    expect(
      getDueReminderKey(
        new Date('2026-10-06T18:30:00Z'),
        'UTC',
        '18:00',
        'every_other_day',
        [1],
      ),
    ).toBe('2026-10-06');
    expect(
      getLocalReminderContext(mondayAt1830Utc, 'Europe/Berlin')?.time,
    ).toBe('20:30');
    expect(getLocalReminderContext(mondayAt1830Utc, 'invalid')).toBeNull();
  });

  it('adds local calendar days without DST arithmetic', () => {
    expect(addCalendarDays('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('converts each recipient local clock time to UTC and rejects DST gaps', () => {
    expect(
      zonedLocalDateTimeToUtc(
        '2026-10-02T18:00',
        'Europe/Berlin',
      )?.toISOString(),
    ).toBe('2026-10-02T16:00:00.000Z');
    expect(
      zonedLocalDateTimeToUtc(
        '2026-10-02T18:00',
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-10-02T22:00:00.000Z');
    expect(
      zonedLocalDateTimeToUtc('2026-03-29T02:30', 'Europe/Berlin'),
    ).toBeNull();
  });
});
