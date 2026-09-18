import type { WorkoutHistoryPlanItem } from '../db/schema';

export type HistoryCursor = { finishedAt: Date; id: number };

export const historyKeywords = (query?: string) =>
  (query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);

export function encodeHistoryCursor(finishedAt: Date, id: number) {
  return Buffer.from(`${finishedAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeHistoryCursor(value?: string): HistoryCursor | null {
  if (!value) return null;
  const [dateValue, idValue, extra] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const finishedAt = new Date(dateValue);
  const id = Number(idValue);
  if (extra !== undefined || Number.isNaN(finishedAt.getTime()) || !Number.isInteger(id) || id < 1) return null;
  return { finishedAt, id };
}

export function planCompletion(
  plan: WorkoutHistoryPlanItem[],
  actualSetsByExercise: Map<number, number>,
) {
  const plannedSets = plan.reduce((total, item) => total + item.sets, 0);
  if (!plannedSets) return null;
  const completedSets = plan.reduce(
    (total, item) => total + Math.min(item.sets, actualSetsByExercise.get(item.exerciseId) || 0),
    0,
  );
  return Math.round((completedSets / plannedSets) * 100);
}
