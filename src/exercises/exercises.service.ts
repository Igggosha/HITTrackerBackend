import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { exercises, muscles, exercisesTrainMuscles } from '../db/schema';

@Injectable()
export class ExercisesService {
  async getAllExercises() {
    // Отримуємо сирі дані через джойни
    const rawData = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        muscleId: muscles.id,
        commonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(exercisesTrainMuscles, eq(exercises.id, exercisesTrainMuscles.exerciseId))
      .leftJoin(muscles, eq(exercisesTrainMuscles.muscleId, muscles.id));

    // Групуємо вправи за м'язами або створюємо унікальний список із масивом м'язів
    const map = new Map();

    rawData.forEach((row) => {
      if (!map.has(row.id)) {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          muscles: [],
        });
      }
      if (row.muscleId) {
        // Уникаємо дублювання м'язів для однієї вправи
        const currentMuscleId = row.muscleId;
        const exists = map.get(row.id).muscles.some((m) => m.id === currentMuscleId);
        if (!exists) {
          map.get(row.id).muscles.push({
            id: row.muscleId,
            commonName: row.commonName,
            scientificName: row.scientificName,
          });
        }
      }
    });

    // Повертаємо чистий масив унікальних вправ, де кожна має свій список м'язів
    return Array.from(map.values());
  }

  async getAllMuscles() {
    return db.select().from(muscles);
  }
}