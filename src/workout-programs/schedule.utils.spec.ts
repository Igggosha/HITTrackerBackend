import { expandScheduleDates, scheduleStatus } from './schedule.utils';

describe('program schedule', () => {
  it('keeps a one-time assignment as one date', () => {
    expect(expandScheduleDates('2026-09-02')).toEqual(['2026-09-02']);
  });

  it('materializes weekly repetitions as independent dates', () => {
    expect(expandScheduleDates('2026-09-02', 'weekly', '2026-09-23')).toEqual([
      '2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23',
    ]);
  });

  it('distinguishes planned, missed, and completed assignments', () => {
    expect(scheduleStatus('planned', '2026-09-03', '2026-09-02')).toBe('planned');
    expect(scheduleStatus('planned', '2026-09-01', '2026-09-02')).toBe('missed');
    expect(scheduleStatus('completed', '2026-09-01', '2026-09-02')).toBe('completed');
  });
});
