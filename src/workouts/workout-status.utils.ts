// EN: Centralizes the active and paused states that still represent one open workout session.
// UK: Централізує стани active і paused, які все ще означають одну відкриту сесію тренування.

export const openWorkoutStatuses = ['active', 'paused'] as const;

export const isOpenWorkoutStatus = (status: string) =>
  openWorkoutStatuses.includes(status as (typeof openWorkoutStatuses)[number]);
