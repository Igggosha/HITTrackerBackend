export const WORKOUT_INACTIVITY_LIMIT_MS = 20 * 60 * 1000;

type TimedWorkout = {
  createdAt: Date;
  lastActivityAt: Date;
  pausedAt: Date | null;
  pausedSeconds: number;
  status: string;
};

export const isWorkoutInactive = (lastActivityAt: Date, now: Date) =>
  now.getTime() - lastActivityAt.getTime() >= WORKOUT_INACTIVITY_LIMIT_MS;

export const workoutAutoPauseAt = (lastActivityAt: Date) =>
  new Date(lastActivityAt.getTime() + WORKOUT_INACTIVITY_LIMIT_MS);

export const activeDurationSeconds = (workout: TimedWorkout, now: Date) => {
  const totalSeconds = Math.max(
    0,
    Math.floor((now.getTime() - workout.createdAt.getTime()) / 1000),
  );
  const currentPauseSeconds =
    workout.status === 'paused' && workout.pausedAt
      ? Math.max(
          0,
          Math.floor((now.getTime() - workout.pausedAt.getTime()) / 1000),
        )
      : 0;

  return Math.max(
    0,
    totalSeconds - workout.pausedSeconds - currentPauseSeconds,
  );
};
