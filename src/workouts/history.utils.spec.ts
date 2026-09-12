import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyKeywords,
  planCompletion,
} from './history.utils';

describe('workout history helpers', () => {
  it('round-trips a stable cursor', () => {
    const date = new Date('2026-09-13T10:30:00.000Z');
    expect(decodeHistoryCursor(encodeHistoryCursor(date, 42))).toEqual({ finishedAt: date, id: 42 });
    expect(decodeHistoryCursor('broken')).toBeNull();
  });

  it('matches all normalized keywords', () => {
    expect(historyKeywords('  Full   BODY press ')).toEqual(['full', 'body', 'press']);
  });

  it('does not let extra sets replace a missed exercise', () => {
    const plan = [
      { exerciseId: 1, name: 'Press', sets: 3, reps: 10, weight: null },
      { exerciseId: 2, name: 'Row', sets: 3, reps: 10, weight: null },
    ];
    expect(planCompletion(plan, new Map([[1, 6]]))).toBe(50);
    expect(planCompletion([], new Map())).toBeNull();
  });
});
