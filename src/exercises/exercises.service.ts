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
   * Отримати вправи для конкретного користувача на основі його програми
   */
  async getExercisesForUser(
    userId: number,
    weekDay?: number,
    week?: number,
  ) {
    const userProgram = await this.db
      .select({
        programId: usersWorkoutPrograms.programId,
        dayInProgram: usersWorkoutPrograms.dayInProgram,
      })
      .from(usersWorkoutPrograms)
      .where(eq(usersWorkoutPrograms.userId, userId))
      .limit(1);

    if (userProgram.length === 0) {
      return [];
    }

    const { programId, dayInProgram } = userProgram[0];
    const targetWeekDay = weekDay ?? dayInProgram;
    let targetWeek = week!;

    if (targetWeek === undefined) {
      const latestWeek = await this.db
        .select({
          week: programContent.week,
        })
        .from(programContent)
        .where(eq(programContent.programId, programId))
        .orderBy(desc(programContent.week))
        .limit(1);

      if (latestWeek.length === 0) {
        return [];
      }

      targetWeek = latestWeek[0].week;
    }

    return this.db
      .select({
        id: exercises.id,
        name: exercises.name,
        sets: exerciseInPrograms.sets,
        reps: exerciseInPrograms.firstSetRepCount,
        weight: exerciseInPrograms.weight,
      })
      .from(exerciseInPrograms)
      .innerJoin(
        programContent,
        eq(programContent.id, exerciseInPrograms.programContentId),
      )
      .innerJoin(
        exercises,
        eq(exercises.id, exerciseInPrograms.exerciseId),
      )
      .where(
        and(
          eq(programContent.programId, programId),
          eq(programContent.week, targetWeek),
          eq(exerciseInPrograms.weekDay, targetWeekDay),
        ),
      );
  }

  /**
   * Отримати список усіх м'язів
   */
  async getAllMuscles() {
    return this.db.select().from(muscles);
  }

  /**
   * Отримати всі вправи разом з їхніми прив'язаними м'язами (Виправлено для фільтрації)
   */
  async getAllExercises() {
    // Використовуємо leftJoin, щоб отримати вправи та id пов'язаних м'язів із проміжної таблиці
    const rows = await this.db
      .select({
        id: exercises.id,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        muscleId: exercisesTrainMuscles.muscleId,
      })
      .from(exercises)
      .leftJoin(
        exercisesTrainMuscles,
        eq(exercises.id, exercisesTrainMuscles.exerciseId),
      );

    // Групуємо результати за ID вправи, щоб зібрати всі зв'язані м'язи в один масив
    const exercisesMap = new Map<number, any>();

    for (const row of rows) {
      if (!exercisesMap.has(row.id)) {
        exercisesMap.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          videoUrl: row.videoUrl,
          exercisesTrainMuscles: [],
        });
      }

      // Якщо до вправи прив'язаний м'яз, додаємо його в масив
      if (row.muscleId !== null) {
        exercisesMap.get(row.id).exercisesTrainMuscles.push({
          muscleId: row.muscleId,
        });
      }
    }

    return Array.from(exercisesMap.values());
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