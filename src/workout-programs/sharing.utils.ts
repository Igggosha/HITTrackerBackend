type ExerciseReference = { exerciseId: number };

export const hasSameExerciseMultiset = (
  left: readonly ExerciseReference[],
  right: readonly ExerciseReference[],
) => {
  if (left.length !== right.length) return false;
  const leftIds = left.map((item) => item.exerciseId).sort((a, b) => a - b);
  const rightIds = right.map((item) => item.exerciseId).sort((a, b) => a - b);
  return leftIds.every((id, index) => id === rightIds[index]);
};
