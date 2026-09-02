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

export function scheduleStatus(status: string, scheduledFor: string, today: string) {
  if (status === 'completed') return 'completed';
  return scheduledFor < today ? 'missed' : 'planned';
}
