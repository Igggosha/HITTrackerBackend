import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
  exercises,
  muscles,
  exercisesTrainMuscles,
  exerciseInPrograms,
  usersWorkoutPrograms,
  programContent,
  exerciseLikes,
} from '../db/schema';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';

@Injectable()
export class ExercisesService {
  /**
   * Отримати вправи для конкретного користувача на основі його програми
   */
  async getExercisesForUser(userId: number, weekDay?: number, week?: number) {
    const userProgram = await db
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
      const latestWeek = await db
        .select({ week: programContent.week })
        .from(programContent)
        .where(eq(programContent.programId, programId))
        .orderBy(desc(programContent.week))
        .limit(1);

      if (latestWeek.length === 0) {
        return [];
      }
      targetWeek = latestWeek[0].week;
    }

    return db
      .select({
        id: exercises.id,
        name: exercises.name,
        sets: exerciseInPrograms.sets,
        reps: exerciseInPrograms.firstSetRepCount,
        weight: exerciseInPrograms.weight,
      })
      .from(exerciseInPrograms)
      .innerJoin(programContent, eq(programContent.id, exerciseInPrograms.programContentId))
      .innerJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
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
    return db.select().from(muscles);
  }

  /**
   * Отримати всі вправи (з кількістю лайків, статусом та назвами м'язів)
   */
  async getAllExercises(currentUserId?: number) {
    // 1. Отримуємо всі вправи разом з м'язами через JOIN таблиць
    const rows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        difficulty: exercises.difficulty,
        muscleId: muscles.id,
        muscleCommonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(
        exercisesTrainMuscles,
        eq(exercises.id, exercisesTrainMuscles.exerciseId),
      )
      .leftJoin(
        muscles,
        eq(exercisesTrainMuscles.muscleId, muscles.id),
      );

    // 2. Отримуємо кількість лайків для кожної вправи
    const likesData = await db
      .select({
        exerciseId: exerciseLikes.exerciseId,
        likesCount: sql<number>`count(${exerciseLikes.userId})::int`,
      })
      .from(exerciseLikes)
      .groupBy(exerciseLikes.exerciseId);

    const likesMap = new Map<number, number>();
    likesData.forEach((row) => likesMap.set(row.exerciseId, row.likesCount));

    // 3. Отримуємо лайки поточного користувача
    const userLikesSet = new Set<number>();
    if (currentUserId) {
      const userLikesData = await db
        .select({ exerciseId: exerciseLikes.exerciseId })
        .from(exerciseLikes)
        .where(eq(exerciseLikes.userId, currentUserId));
      
      userLikesData.forEach((row) => userLikesSet.add(row.exerciseId));
    }

    // 4. Формуємо фінальний результат з масивом `muscles`
    const exercisesMap = new Map<number, any>();

    for (const row of rows) {
      if (!exercisesMap.has(row.id)) {
        exercisesMap.set(row.id, {
          id: row.id,
          name: row.name,
          description: row.description,
          videoUrl: row.videoUrl,
          difficulty: row.difficulty, 
          likesCount: likesMap.get(row.id) || 0,
          isLiked: userLikesSet.has(row.id),
          muscles: [], // Масив об'єктів м'язів, який очікує фронтенд
        });
      }

      if (row.muscleId !== null) {
        const currentMuscles = exercisesMap.get(row.id).muscles;
        const exists = currentMuscles.some((m: any) => m.id === row.muscleId);
        
        if (!exists) {
          currentMuscles.push({
            id: row.muscleId,
            name: row.muscleCommonName,
            commonName: row.muscleCommonName,
            scientificName: row.scientificName,
          });
        }
      }
    }

    return Array.from(exercisesMap.values());
  }

  /**
   * Створення вправи
   */
  async createExercise(data: CreateExerciseDto) {
    const trimmedName = data.name.trim();

    const existing = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(ilike(exercises.name, trimmedName))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Exercise "${trimmedName}" already exists in the database.`);
    }

    return db.transaction(async (tx: any) => {
      const [newExercise] = await tx
        .insert(exercises)
        .values({
          name: trimmedName,
          description: data.description?.trim() || null,
          videoUrl: data.videoUrl?.trim() || null,
          difficulty: data.difficulty || 1,
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

  async updateExercise(id: number, data: UpdateExerciseDto) {
    const { muscleIds, ...exercise } = data;
    const changes = {
      ...(exercise.name !== undefined ? { name: exercise.name.trim() } : {}),
      ...(exercise.description !== undefined ? { description: exercise.description.trim() || null } : {}),
      ...(exercise.videoUrl !== undefined ? { videoUrl: exercise.videoUrl.trim() || null } : {}),
      ...(exercise.difficulty !== undefined ? { difficulty: exercise.difficulty } : {}),
    };

    try {
      return await db.transaction(async (tx: any) => {
        let updated;
        if (Object.keys(changes).length) {
          [updated] = await tx
            .update(exercises)
            .set(changes)
            .where(eq(exercises.id, id))
            .returning();
        } else {
          [updated] = await tx.select().from(exercises).where(eq(exercises.id, id)).limit(1);
        }
        if (!updated) throw new NotFoundException('Exercise not found');

        if (muscleIds !== undefined) {
          await tx.delete(exercisesTrainMuscles).where(eq(exercisesTrainMuscles.exerciseId, id));
          if (muscleIds.length) {
            await tx.insert(exercisesTrainMuscles).values(
              muscleIds.map((muscleId) => ({ exerciseId: id, muscleId })),
            );
          }
        }

        return { ...updated, muscleIds: muscleIds ?? undefined };
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`Exercise "${changes.name}" already exists in the database.`);
      }
      throw error;
    }
  }

  /**
   * Поставити або прибрати лайк
   */
  async toggleLike(userId: number, exerciseId: number) {
    const existingLike = await db
      .select()
      .from(exerciseLikes)
      .where(
        and(
          eq(exerciseLikes.userId, userId),
          eq(exerciseLikes.exerciseId, exerciseId)
        )
      )
      .limit(1);

    if (existingLike.length > 0) {
      await db
        .delete(exerciseLikes)
        .where(
          and(
            eq(exerciseLikes.userId, userId),
            eq(exerciseLikes.exerciseId, exerciseId)
          )
        );
      return { isLiked: false };
    } else {
      await db.insert(exerciseLikes).values({
        userId,
        exerciseId,
      });
      return { isLiked: true };
    }
  }
}
