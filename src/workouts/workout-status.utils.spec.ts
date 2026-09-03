import { isOpenWorkoutStatus } from './workout-status.utils';

describe('isOpenWorkoutStatus', () => {
  it.each(['active', 'paused'])('accepts an open workout status: %s', (status) => {
    expect(isOpenWorkoutStatus(status)).toBe(true);
  });

  it.each(['completed', 'cancelled', 'unknown'])('rejects a closed workout status: %s', (status) => {
    expect(isOpenWorkoutStatus(status)).toBe(false);
  });
});
