// EN: Covers future-safe locale validation and localized YouTube metadata at the API boundary.
// UK: Перевіряє розширювані locale та локалізовані YouTube-метадані на межі API.

import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  CreateExerciseDto,
  ExerciseTranslationDto,
} from './create-exercise.dto';

it.each(['en', 'uk', 'de', 'en-US'])(
  'accepts supported locale syntax: %s',
  async (locale) => {
    const translation = Object.assign(new ExerciseTranslationDto(), {
      locale,
      name: 'Plank',
      videoUrl: 'https://www.youtube.com/watch?v=example',
    });
    await expect(validate(translation)).resolves.toHaveLength(0);
  },
);

it('keeps duration and repetition recommendations as separate DTO fields', async () => {
  const dto = Object.assign(new CreateExerciseDto(), {
    name: 'Plank',
    measurementType: 'duration',
    recommendedSets: 3,
    recommendedDurationSeconds: 45,
  });

  await expect(validate(dto)).resolves.toHaveLength(0);
});
