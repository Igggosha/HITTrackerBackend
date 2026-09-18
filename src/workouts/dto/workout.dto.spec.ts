import 'reflect-metadata';
import { validate } from 'class-validator';
import { RecordSetDto, UpdateSetDto } from './workout.dto';

describe('workout set DTOs', () => {
  const validSet = { exerciseId: 1, weight: 0, reps: 8, rpe: 7, isFailure: false };

  it('accepts bodyweight sets with an explicit RPE', async () => {
    expect(await validate(Object.assign(new RecordSetDto(), validSet))).toHaveLength(0);
    expect(
      await validate(Object.assign(new UpdateSetDto(), validSet)),
    ).toHaveLength(0);
  });

  it.each([
    ['missing RPE', { ...validSet, rpe: undefined }],
    ['RPE below the scale', { ...validSet, rpe: 0 }],
    ['RPE above the scale', { ...validSet, rpe: 11 }],
    ['zero repetitions', { ...validSet, reps: 0 }],
  ])('rejects %s', async (_label, input) => {
    expect(
      await validate(Object.assign(new RecordSetDto(), input)),
    ).not.toHaveLength(0);
  });
});
