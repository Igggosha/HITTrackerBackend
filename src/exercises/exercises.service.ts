import { Injectable, ConflictException } from '@nestjs/common';
import {and, desc, eq} from 'drizzle-orm';
import { db } from '../db/db';
import {
    exercises,
    muscles,
    exercisesTrainMuscles,
    exerciseInPrograms,
    usersWorkoutPrograms,
    programContent
} from '../db/schema';

@Injectable()
export class ExercisesService {

    async getExercisesForUser(
        userId: number,
        weekDay: number,
        week?: number,
    ) {
        if (week === undefined) {
            const latestWeek = await db
                .select({
                    week: programContent.week,
                })
                .from(usersWorkoutPrograms)
                .innerJoin(
                    programContent,
                    eq(
                        programContent.programId,
                        usersWorkoutPrograms.programId,
                    ),
                )
                .where(
                    eq(usersWorkoutPrograms.userId, userId),
                )
                .orderBy(desc(programContent.week))
                .limit(1);

            week = latestWeek[0]?.week;
        }

        // User has no program / program has no content
        if (week === undefined) {
            return [];
        }

        return db
            .select({
                id: exercises.id,
                name: exercises.name,
                sets: exerciseInPrograms.sets,
                reps: exerciseInPrograms.firstSetRepCount,
                weight: exerciseInPrograms.weight,
            })
            .from(usersWorkoutPrograms)
            .innerJoin(
                programContent,
                eq(
                    programContent.programId,
                    usersWorkoutPrograms.programId,
                ),
            )
            .innerJoin(
                exerciseInPrograms,
                eq(
                    exerciseInPrograms.programContentId,
                    programContent.id,
                ),
            )
            .innerJoin(
                exercises,
                eq(
                    exercises.id,
                    exerciseInPrograms.exerciseId,
                ),
            )
            .where(
                and(
                    eq(usersWorkoutPrograms.userId, userId),
                    eq(programContent.week, week),
                    eq(exerciseInPrograms.weekDay, weekDay),
                ),
            );
    }
  async getAllExercises() {
    const rawData = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        muscleId: muscles.id,
        commonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(exercisesTrainMuscles, eq(exercises.id, exercisesTrainMuscles.exerciseId))
      .leftJoin(muscles, eq(exercisesTrainMuscles.muscleId, muscles.id));

    const map = new Map();

    rawData.forEach((row) => {
      if (!map.has(row.id)) {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          videoUrl: row.videoUrl,
          muscles: [],
        });
      }
      if (row.muscleId) {
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

    return Array.from(map.values());
  }

  async getAllMuscles() {
    return db.select().from(muscles);
  }

  async createExercise(data: {
    name: string;
    description?: string;
    videoUrl?: string;
    muscleIds?: number[];
  }) {
    const trimmedName = data.name.trim();

    // 1. Перевіряємо, чи існує вже така вправа в базі даних
    const existing = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(eq(exercises.name, trimmedName))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Exercise "${trimmedName}" already exists in the database.`);
    }

    // 2. Якщо вправи немає — створюємо новий запис
    return await db.transaction(async (tx) => {
      const [newExercise] = await tx
        .insert(exercises)
        .values({
          name: trimmedName,
          description: data.description?.trim() || null,
          videoUrl: data.videoUrl?.trim() || null,
        })
        .returning();

      if (data.muscleIds && data.muscleIds.length > 0) {
        const relations = data.muscleIds.map((muscleId) => ({
          exerciseId: newExercise.id,
          muscleId: muscleId,
        }));

        await tx.insert(exercisesTrainMuscles).values(relations);
      }

      return newExercise;
    });
  }
}