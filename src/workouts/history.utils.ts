// EN: Merges a stored workout plan with performed sets so history remains readable even when source catalog data later changes.
// UK: Об'єднує збережений план тренування з виконаними підходами, щоб історія залишалася зрозумілою після змін вихідних даних каталогу.

import type { WorkoutHistoryPlanItem } from '../db/schema';

export type HistoryCursor = { finishedAt: Date; id: number };

export const historyKeywords = (query?: string) =>
  (query || '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);

const freeWorkoutSearchAliases = new Set([
  'free',
  'free workout',
  'вільне',
  'вільне тренування',
]);

/** EN: Recognizes localized free-workout labels without storing localized domain text. UK: Розпізнає локалізовані назви вільного тренування без збереження перекладеного доменного тексту. */
export const isFreeWorkoutSearch = (query?: string) =>
  freeWorkoutSearchAliases.has(
    (query || '').trim().toLocaleLowerCase().replace(/\s+/g, ' '),
  );

/** EN: Derives semantic free-workout identity from the immutable source snapshot, with a legacy fallback. UK: Визначає семантичний тип вільного тренування зі знімка джерела з fallback для старих записів. */
export const isFreeWorkoutRecord = (workout: {
  historySnapshot?: { programId?: number | null } | null;
  programContentId?: number | null;
}) =>
  workout.historySnapshot
    ? workout.historySnapshot.programId == null
    : workout.programContentId == null;

export function encodeHistoryCursor(finishedAt: Date, id: number) {
  return Buffer.from(`${finishedAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeHistoryCursor(value?: string): HistoryCursor | null {
  if (!value) return null;
  const [dateValue, idValue, extra] = Buffer.from(value, 'base64url')
    .toString('utf8')
    .split('|');
  const finishedAt = new Date(dateValue);
  const id = Number(idValue);
  if (
    extra !== undefined ||
    Number.isNaN(finishedAt.getTime()) ||
    !Number.isInteger(id) ||
    id < 1
  )
    return null;
  return { finishedAt, id };
}

export function planCompletion(
  plan: WorkoutHistoryPlanItem[],
  actualByExercise: Map<
    number,
    { durationSeconds: number; reps: number; sets: number }
  >,
) {
  const plannedSets = plan.reduce((total, item) => total + item.sets, 0);
  if (!plannedSets) return null;
  const completedSets = plan.reduce((total, item) => {
    const actual = actualByExercise.get(item.exerciseId) || {
      durationSeconds: 0,
      reps: 0,
      sets: 0,
    };
    const targetPerSet =
      item.measurementType === 'duration'
        ? item.targetDurationSeconds || 0
        : item.reps || 0;
    const actualMetric =
      item.measurementType === 'duration'
        ? actual.durationSeconds
        : actual.reps;
    const metricSets =
      targetPerSet > 0 ? actualMetric / targetPerSet : actual.sets;
    return total + Math.min(item.sets, actual.sets, metricSets);
  }, 0);
  return Math.round((completedSets / plannedSets) * 100);
}
