import { Inject, Injectable, ConflictException, Optional } from '@nestjs/common';
import { and, desc, eq, ilike } from 'drizzle-orm';
import { db as defaultDb } from '../db/db';
import {
  exercises,
  muscles,
  exercisesTrainMuscles,
  exerciseInPrograms,
  usersWorkoutPrograms,
  programContent,
} from '../db/schema';

@Injectable()
export class ExercisesService {
  constructor(
    @Optional() @Inject('DRIZZLE_DB') private readonly injectedDb?: any,
  ) {}

  // Гнучке використання БД (через NestJS DI або прямий імпорт)
  private get db() {
    return this.injectedDb || defaultDb;
  }

  /**
   * Отримати вправи для конкретного користувача на основі його програми (метод колеги)
   */
  async getExercisesForUser(
    userId: number,
    weekDay: number,
    week?: number,
  ) {
    if (week === undefined) {
      const latestWeek = await this.db
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

    return this.db
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

  /**
   * Отримати всі вправи з прив'язаними м'язами
   */
  async getAllExercises() {
    const rawData = await this.db
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

    const map = new Map<number, any>();

    for (const row of rawData) {
      if (!map.has(row.id)) {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          videoUrl: row.videoUrl,
          muscles: [],
        });
      }

      const currentExercise = map.get(row.id);

      if (row.muscleId) {
        const alreadyAdded = currentExercise.muscles.some((m: any) => m.id === row.muscleId);
        if (!alreadyAdded) {
          currentExercise.muscles.push({
            id: row.muscleId,
            commonName: row.commonName,
            scientificName: row.scientificName,
          });
        }
      }
    }

    return Array.from(map.values());
  }

  /**
   * Отримати список усіх м'язів
   */
  async getAllMuscles() {
    return this.db.select().from(muscles);
  }

  /**
   * Створення вправи з прив'язкою м'язів
   */
  async createExercise(data: {
    name: string;
    description?: string;
    videoUrl?: string;
    muscleIds?: number[];
  }) {
    const trimmedName = data.name.trim();

    // 1. Перевірка на існування (ігноруємо регістр слів за допомогою ilike)
    const existing = await this.db
      .select({ id: exercises.id })
      .from(exercises)
      .where(ilike(exercises.name, trimmedName))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Exercise "${trimmedName}" already exists in the database.`);
    }

    // 2. Транзакція для створення вправи та її зв'язків
    return await this.db.transaction(async (tx: any) => {
      const [newExercise] = await tx
        .insert(exercises)
        .values({
          name: trimmedName,
          description: data.description?.trim() || null,
          videoUrl: data.videoUrl?.trim() || null,
        })
        .returning();

      if (data.muscleIds && data.muscleIds.length > 0) {
        // Очищаємо від можливих дублікатів у масиві (наприклад, [1, 1, 2] -> [1, 2])
        const uniqueMuscleIds = Array.from(new Set(data.muscleIds));

        const relations = uniqueMuscleIds.map((muscleId) => ({
          exerciseId: newExercise.id,
          muscleId: muscleId,
        }));

        await tx.insert(exercisesTrainMuscles).values(relations);
      }

      return {
        ...newExercise,
        muscleIds: data.muscleIds || [],
      };
    });
  }
}