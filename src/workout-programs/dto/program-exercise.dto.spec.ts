// EN: Proves that catalog programs may omit recommendations while exercise identity and schedule placement remain required.
// UK: Підтверджує, що каталог програм може не містити рекомендацій, але вправа й день розкладу залишаються обов'язковими.

import 'reflect-metadata';
import { validate } from 'class-validator';
import { ProgramExerciseDto } from './create-workout-program.dto';

it('accepts an exercise without sets, reps, duration, or weight', async () => {
  const dto = Object.assign(new ProgramExerciseDto(), {
    exerciseId: 7,
    weekDay: 0,
  });

  await expect(validate(dto)).resolves.toHaveLength(0);
});

it.each([{ weekDay: 0 }, { exerciseId: 7 }])(
  'requires exerciseId and weekDay: %p',
  async (value) => {
    const errors = await validate(
      Object.assign(new ProgramExerciseDto(), value),
    );

    expect(errors.length).toBeGreaterThan(0);
  },
);
