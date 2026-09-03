export const openWorkoutStatuses = ['active', 'paused'] as const;

export const isOpenWorkoutStatus = (status: string) =>
  openWorkoutStatuses.includes(status as (typeof openWorkoutStatuses)[number]);
