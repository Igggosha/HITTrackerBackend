import {
  activeDurationSeconds,
  isWorkoutInactive,
  WORKOUT_INACTIVITY_LIMIT_MS,
  workoutAutoPauseAt,
} from './workout-timing.utils';

describe('workout timing', () => {
  const startedAt = new Date('2026-09-13T10:00:00.000Z');

  it('pauses precisely after twenty minutes without a heartbeat', () => {
    const lastActivityAt = new Date('2026-09-13T10:15:00.000Z');
    const cutoff = workoutAutoPauseAt(lastActivityAt);

    expect(cutoff).toEqual(new Date('2026-09-13T10:35:00.000Z'));
    expect(
      isWorkoutInactive(lastActivityAt, new Date(cutoff.getTime() - 1)),
    ).toBe(false);
    expect(isWorkoutInactive(lastActivityAt, cutoff)).toBe(true);
    expect(WORKOUT_INACTIVITY_LIMIT_MS).toBe(20 * 60 * 1000);
  });

  it('excludes time after an automatic pause from the active duration', () => {
    const pausedAt = new Date('2026-09-13T10:35:00.000Z');

    expect(
      activeDurationSeconds(
        {
          createdAt: startedAt,
          lastActivityAt: new Date('2026-09-13T10:15:00.000Z'),
          pausedAt,
          pausedSeconds: 0,
          status: 'paused',
        },
        new Date('2026-09-13T14:15:00.000Z'),
      ),
    ).toBe(35 * 60);
  });

  it('keeps prior manual pauses out of the final duration', () => {
    expect(
      activeDurationSeconds(
        {
          createdAt: startedAt,
          lastActivityAt: new Date('2026-09-13T11:10:00.000Z'),
          pausedAt: new Date('2026-09-13T11:10:00.000Z'),
          pausedSeconds: 10 * 60,
          status: 'paused',
        },
        new Date('2026-09-13T12:00:00.000Z'),
      ),
    ).toBe(60 * 60);
  });
});
