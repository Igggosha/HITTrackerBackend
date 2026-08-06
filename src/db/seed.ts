import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

async function seed() {
  console.log('🌱 Запуск сидування бази даних...');

  // 1. Очищення старих даних із довідників (запобігає дублюванню при повторному запуску)
  await db.delete(schema.exercisesTrainMuscles);
  await db.delete(schema.exercises);
  await db.delete(schema.muscles);

  // 2. Додавання основних м'язових груп (англійською)
  const insertedMuscles = await db
    .insert(schema.muscles)
    .values([
      { commonName: 'Chest', scientificName: 'Pectoralis Major' },
      { commonName: 'Lats', scientificName: 'Latissimus Dorsi' },
      { commonName: 'Quadriceps', scientificName: 'Quadriceps Femoris' },
      { commonName: 'Hamstrings', scientificName: 'Biceps Femoris' },
      { commonName: 'Deltoids', scientificName: 'Deltoideus' },
      { commonName: 'Triceps', scientificName: 'Triceps Brachii' },
      { commonName: 'Biceps', scientificName: 'Biceps Brachii' },
      { commonName: 'Abs', scientificName: 'Rectus Abdominis' },
      { commonName: 'Glutes', scientificName: 'Gluteus Maximus' },
      { commonName: 'Calves', scientificName: 'Gastrocnemius' },
      { commonName: 'Lower Back', scientificName: 'Erector Spinae' },
      { commonName: 'Traps', scientificName: 'Trapezius' },
    ])
    .returning();

  // функція для пошуку ID м'яза за назвою
  const getMuscleId = (name: string) =>
    insertedMuscles.find((m) => m.commonName === name)!.id;

  // 3. Додавання популярних силових та HIT-вправ
  const insertedExercises = await db
    .insert(schema.exercises)
    .values([
      // Грудні м'язи
      { name: 'Barbell Bench Press' },
      { name: 'Incline Dumbbell Press' },
      { name: 'Dips' },
      { name: 'Cable Chest Flyes' },

      // Спина
      { name: 'Pull-ups' },
      { name: 'Lat Pulldown' },
      { name: 'Barbell Bent-Over Row' },
      { name: 'Seated Cable Row' },

      // Ноги та сідниці
      { name: 'Barbell Back Squat' },
      { name: 'Leg Press' },
      { name: 'Romanian Deadlift' },
      { name: 'Leg Extension' },
      { name: 'Lying Leg Curl' },
      { name: 'Standing Calf Raise' },

      // плечі
      { name: 'Overhead Press' },
      { name: 'Dumbbell Lateral Raise' },
      { name: 'Face Pulls' },

      // руки
      { name: 'Barbell Biceps Curl' },
      { name: 'Dumbbell Hammer Curl' },
      { name: 'Triceps Cable Pushdown' },
      { name: 'Skull Crushers' },

      // Корпус та базові вправи
      { name: 'Conventional Deadlift' },
      { name: 'Hanging Leg Raise' },
    ])
    .returning();

  // Допоміжна функція для пошуку ID вправи за назвою
  const getExerciseId = (name: string) =>
    insertedExercises.find((e) => e.name === name)!.id;

  // 4. Зв'язування вправ із відповідними м'язовими групами
  await db.insert(schema.exercisesTrainMuscles).values([
    // Грудні + Тріцепс + Дельти
    {
      exerciseId: getExerciseId('Barbell Bench Press'),
      muscleId: getMuscleId('Chest'),
    },
    {
      exerciseId: getExerciseId('Barbell Bench Press'),
      muscleId: getMuscleId('Triceps'),
    },
    {
      exerciseId: getExerciseId('Barbell Bench Press'),
      muscleId: getMuscleId('Deltoids'),
    },

    {
      exerciseId: getExerciseId('Incline Dumbbell Press'),
      muscleId: getMuscleId('Chest'),
    },
    {
      exerciseId: getExerciseId('Incline Dumbbell Press'),
      muscleId: getMuscleId('Deltoids'),
    },

    { exerciseId: getExerciseId('Dips'), muscleId: getMuscleId('Chest') },
    { exerciseId: getExerciseId('Dips'), muscleId: getMuscleId('Triceps') },

    {
      exerciseId: getExerciseId('Cable Chest Flyes'),
      muscleId: getMuscleId('Chest'),
    },

    // Спина + Біцепс + Трапеції
    { exerciseId: getExerciseId('Pull-ups'), muscleId: getMuscleId('Lats') },
    { exerciseId: getExerciseId('Pull-ups'), muscleId: getMuscleId('Biceps') },

    {
      exerciseId: getExerciseId('Lat Pulldown'),
      muscleId: getMuscleId('Lats'),
    },
    {
      exerciseId: getExerciseId('Lat Pulldown'),
      muscleId: getMuscleId('Biceps'),
    },

    {
      exerciseId: getExerciseId('Barbell Bent-Over Row'),
      muscleId: getMuscleId('Lats'),
    },
    {
      exerciseId: getExerciseId('Barbell Bent-Over Row'),
      muscleId: getMuscleId('Traps'),
    },
    {
      exerciseId: getExerciseId('Barbell Bent-Over Row'),
      muscleId: getMuscleId('Biceps'),
    },

    {
      exerciseId: getExerciseId('Seated Cable Row'),
      muscleId: getMuscleId('Lats'),
    },
    {
      exerciseId: getExerciseId('Seated Cable Row'),
      muscleId: getMuscleId('Traps'),
    },

    // Ноги
    {
      exerciseId: getExerciseId('Barbell Back Squat'),
      muscleId: getMuscleId('Quadriceps'),
    },
    {
      exerciseId: getExerciseId('Barbell Back Squat'),
      muscleId: getMuscleId('Glutes'),
    },

    {
      exerciseId: getExerciseId('Leg Press'),
      muscleId: getMuscleId('Quadriceps'),
    },
    { exerciseId: getExerciseId('Leg Press'), muscleId: getMuscleId('Glutes') },

    {
      exerciseId: getExerciseId('Romanian Deadlift'),
      muscleId: getMuscleId('Hamstrings'),
    },
    {
      exerciseId: getExerciseId('Romanian Deadlift'),
      muscleId: getMuscleId('Glutes'),
    },

    {
      exerciseId: getExerciseId('Leg Extension'),
      muscleId: getMuscleId('Quadriceps'),
    },
    {
      exerciseId: getExerciseId('Lying Leg Curl'),
      muscleId: getMuscleId('Hamstrings'),
    },
    {
      exerciseId: getExerciseId('Standing Calf Raise'),
      muscleId: getMuscleId('Calves'),
    },

    // Плечі
    {
      exerciseId: getExerciseId('Overhead Press'),
      muscleId: getMuscleId('Deltoids'),
    },
    {
      exerciseId: getExerciseId('Overhead Press'),
      muscleId: getMuscleId('Triceps'),
    },

    {
      exerciseId: getExerciseId('Dumbbell Lateral Raise'),
      muscleId: getMuscleId('Deltoids'),
    },
    {
      exerciseId: getExerciseId('Face Pulls'),
      muscleId: getMuscleId('Deltoids'),
    },
    { exerciseId: getExerciseId('Face Pulls'), muscleId: getMuscleId('Traps') },

    // Руки
    {
      exerciseId: getExerciseId('Barbell Biceps Curl'),
      muscleId: getMuscleId('Biceps'),
    },
    {
      exerciseId: getExerciseId('Dumbbell Hammer Curl'),
      muscleId: getMuscleId('Biceps'),
    },

    {
      exerciseId: getExerciseId('Triceps Cable Pushdown'),
      muscleId: getMuscleId('Triceps'),
    },
    {
      exerciseId: getExerciseId('Skull Crushers'),
      muscleId: getMuscleId('Triceps'),
    },

    // Корпус та фулбоді
    {
      exerciseId: getExerciseId('Conventional Deadlift'),
      muscleId: getMuscleId('Lower Back'),
    },
    {
      exerciseId: getExerciseId('Conventional Deadlift'),
      muscleId: getMuscleId('Glutes'),
    },
    {
      exerciseId: getExerciseId('Conventional Deadlift'),
      muscleId: getMuscleId('Hamstrings'),
    },
    {
      exerciseId: getExerciseId('Conventional Deadlift'),
      muscleId: getMuscleId('Traps'),
    },

    {
      exerciseId: getExerciseId('Hanging Leg Raise'),
      muscleId: getMuscleId('Abs'),
    },
  ]);

  console.log('✅ Сидування успішно завершено!');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌ Помилка сидування:', err);
  pool.end();
  process.exit(1);
});
