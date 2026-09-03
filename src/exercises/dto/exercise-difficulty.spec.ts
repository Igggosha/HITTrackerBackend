import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateExerciseDto } from './create-exercise.dto';
import { UpdateExerciseDto } from './update-exercise.dto';

it.each([CreateExerciseDto, UpdateExerciseDto])('%p accepts only integer difficulty levels 1–5', async (Dto) => {
  for (const difficulty of [1, 2, 3, 4, 5]) {
    expect(await validate(Object.assign(new Dto(), { name: 'Test', difficulty }))).toHaveLength(0);
  }
  for (const difficulty of [0, 6, -1, 2.5]) {
    const errors = await validate(Object.assign(new Dto(), { name: 'Test', difficulty }));
    expect(errors.some((error) => error.property === 'difficulty')).toBe(true);
  }
});
