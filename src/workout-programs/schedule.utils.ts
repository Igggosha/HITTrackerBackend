const DAY_MS = 24 * 60 * 60 * 1000;

export function expandScheduleDates(start: string, repeat: 'none' | 'weekly' = 'none', repeatUntil?: string) {
  if (repeat === 'none') return [start];

  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${repeatUntil ?? start}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [start];

  const dates: string[] = [];
  for (let current = first; current <= last && dates.length < 53; current += 7 * DAY_MS) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

export function weeklyDatesInRange(start: string, from: string, to: string) {
  const first = Date.parse(`${start}T00:00:00Z`);
  const lowerBound = Date.parse(`${from}T00:00:00Z`);
  const upperBound = Date.parse(`${to}T00:00:00Z`);
  if (![first, lowerBound, upperBound].every(Number.isFinite) || upperBound < first || upperBound < lowerBound) return [];

  const offset = Math.max(0, Math.ceil((lowerBound - first) / (7 * DAY_MS)));
  const dates: string[] = [];
  for (let current = first + offset * 7 * DAY_MS; current <= upperBound; current += 7 * DAY_MS) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }
  return dates;
}

export function scheduleStatus(status: string, scheduledFor: string, today: string) {
  if (status === 'completed') return 'completed';
  return scheduledFor < today ? 'missed' : 'planned';
}
