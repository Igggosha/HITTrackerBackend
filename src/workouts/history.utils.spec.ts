// EN: Verifies immutable history-plan construction and preservation of exercise order and recorded performance.
// UK: Перевіряє створення незмінного плану історії та збереження порядку вправ і записаних результатів.

import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyKeywords,
  isFreeWorkoutRecord,
  isFreeWorkoutSearch,
  planCompletion,
} from './history.utils';

describe('workout history helpers', () => {
  it('round-trips a stable cursor', () => {
    const date = new Date('2026-09-13T10:30:00.000Z');
    expect(decodeHistoryCursor(encodeHistoryCursor(date, 42))).toEqual({
      finishedAt: date,
      id: 42,
    });
    expect(decodeHistoryCursor('broken')).toBeNull();
  });

  it('matches all normalized keywords', () => {
    expect(historyKeywords('  Full   BODY press ')).toEqual([
      'full',
      'body',
      'press',
    ]);
  });

  it('recognizes localized free-workout searches and derives the semantic type', () => {
    expect(isFreeWorkoutSearch(' Free   workout ')).toBe(true);
    expect(isFreeWorkoutSearch('Freestyle workout')).toBe(true);
    expect(isFreeWorkoutSearch('Вільне тренування')).toBe(true);
    expect(isFreeWorkoutSearch('Full body')).toBe(false);
    expect(
      isFreeWorkoutRecord({
        historySnapshot: { programId: null },
        programContentId: 7,
      }),
    ).toBe(true);
    expect(
      isFreeWorkoutRecord({
        historySnapshot: { programId: 4 },
        programContentId: null,
      }),
    ).toBe(false);
    expect(
      isFreeWorkoutRecord({ historySnapshot: null, programContentId: null }),
    ).toBe(true);
    expect(
      isFreeWorkoutRecord({ historySnapshot: null, programContentId: 9 }),
    ).toBe(false);
  });

  it('does not let extra sets replace a missed exercise', () => {
    const plan = [
      { exerciseId: 1, name: 'Press', sets: 3, reps: 10, weight: null },
      { exerciseId: 2, name: 'Row', sets: 3, reps: 10, weight: null },
    ];
    expect(
      planCompletion(
        plan,
        new Map([[1, { durationSeconds: 0, reps: 60, sets: 6 }]]),
      ),
    ).toBe(50);
    expect(planCompletion([], new Map())).toBeNull();
  });

  it('uses aggregate seconds while still requiring the planned set count', () => {
    const plan = [
      {
        exerciseId: 1,
        measurementType: 'duration' as const,
        name: 'Plank',
        reps: null,
        sets: 3,
        targetDurationSeconds: 45,
        weight: null,
      },
    ];
    expect(
      planCompletion(
        plan,
        new Map([[1, { durationSeconds: 135, reps: 0, sets: 3 }]]),
      ),
    ).toBe(100);
    expect(
      planCompletion(
        plan,
        new Map([[1, { durationSeconds: 135, reps: 0, sets: 1 }]]),
      ),
    ).toBe(33);
  });
});
