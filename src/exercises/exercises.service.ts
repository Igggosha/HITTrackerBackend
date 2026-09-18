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
  exerciseBookmarks,
} from '../db/schema';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { UpdateExerciseDto } from './dto/update-exercise.dto';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';

@Injectable()
export class ExercisesService {
  constructor(private readonly storageService: StorageService) {}

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
        imageKey: exercises.imageKey,
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
    const bookmarked = currentUserId ? await db.select({ exerciseId: exerciseBookmarks.exerciseId })
      .from(exerciseBookmarks).where(eq(exerciseBookmarks.userId, currentUserId)) : [];
    const bookmarks = new Set(bookmarked.map((row) => row.exerciseId));
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
          imageKey: row.imageKey,
          difficulty: row.difficulty,
          likesCount: likesMap.get(row.id) || 0,
          isLiked: userLikesSet.has(row.id),
          isBookmarked: bookmarks.has(row.id),
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

    // Presigning is a local HMAC, so signing a whole page costs no round trips.
    return this.withImageUrls(Array.from(exercisesMap.values()));
  }

  async getSharedExerciseById(id: number) {
    const rows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        imageKey: exercises.imageKey,
        difficulty: exercises.difficulty,
        muscleId: muscles.id,
        muscleCommonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(exercisesTrainMuscles, eq(exercises.id, exercisesTrainMuscles.exerciseId))
      .leftJoin(muscles, eq(exercisesTrainMuscles.muscleId, muscles.id))
      .where(eq(exercises.id, id));

    if (!rows.length) throw new NotFoundException('Exercise not found');
    const exercise = rows[0];
    return this.withImageUrl({
      id: exercise.id,
      name: exercise.name,
      description: exercise.description,
      videoUrl: exercise.videoUrl,
      imageKey: exercise.imageKey,
      difficulty: exercise.difficulty,
      muscles: rows.flatMap((row) => row.muscleId === null ? [] : [{
        id: row.muscleId,
        name: row.muscleCommonName,
        commonName: row.muscleCommonName,
        scientificName: row.scientificName,
      }]),
    });
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
    }).then((created) => this.withImageUrl(created));
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
      }).then((result) => this.withImageUrl(result));
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException(`Exercise "${changes.name}" already exists in the database.`);
      }
      throw error;
    }
  }

  /**
   * Replaces an exercise illustration. Moderator-only; enforced by the guard on
   * the controller, not here.
   */
  async setImage(exerciseId: number, file: UploadedFile | undefined) {
    const [exercise] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1);
    if (!exercise) throw new NotFoundException('Exercise not found');

    const stored = await this.storageService.uploadImage({
      scope: 'exercises',
      ownerId: exerciseId,
      file,
      maxDimension: this.storageService.limits.exerciseImageMaxDimension,
    });

    let replacedKey: string | null;
    try {
      replacedKey = await this.setImageKey(exerciseId, stored.key);
    } catch (error) {
      // Nothing references the new object, so it must not be left behind.
      await this.storageService.remove(stored.key);
      throw error;
    }

    await this.storageService.remove(replacedKey);

    return this.getSharedExerciseById(exerciseId);
  }

  async removeImage(exerciseId: number) {
    const replacedKey = await this.setImageKey(exerciseId, null);
    await this.storageService.remove(replacedKey);

    return this.getSharedExerciseById(exerciseId);
  }

  /**
   * Swaps the stored image key and returns the replaced one so its object can
   * be deleted once no row points at it.
   */
  private async setImageKey(
    exerciseId: number,
    imageKey: string | null,
  ): Promise<string | null> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ imageKey: exercises.imageKey })
        .from(exercises)
        .where(eq(exercises.id, exerciseId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('Exercise not found');

      await tx
        .update(exercises)
        .set({ imageKey })
        .where(eq(exercises.id, exerciseId));

      return current.imageKey === imageKey ? null : current.imageKey;
    });
  }

  /**
   * Swaps the internal object key for a presigned URL. The key never leaves
   * the API, so a client cannot address the bucket directly.
   */
  private async withImageUrl<T extends { imageKey?: string | null }>(
    row: T,
  ): Promise<Omit<T, 'imageKey'> & { imageUrl: string | null }> {
    const { imageKey, ...rest } = row;
    return {
      ...rest,
      imageUrl: await this.storageService.getUrl(imageKey),
    };
  }

  private async withImageUrls<T extends { imageKey?: string | null }>(
    rows: T[],
  ): Promise<(Omit<T, 'imageKey'> & { imageUrl: string | null })[]> {
    return Promise.all(rows.map((row) => this.withImageUrl(row)));
  }

  async toggleBookmark(userId: number, exerciseId: number) {
    const [exercise] = await db.select({ id: exercises.id }).from(exercises).where(eq(exercises.id, exerciseId)).limit(1);
    if (!exercise) throw new NotFoundException('Exercise not found');
    const removed = await db.delete(exerciseBookmarks).where(and(
      eq(exerciseBookmarks.userId, userId), eq(exerciseBookmarks.exerciseId, exerciseId),
    )).returning();
    if (!removed.length) await db.insert(exerciseBookmarks).values({ userId, exerciseId }).onConflictDoNothing();
    return { isBookmarked: !removed.length };
  }

  /**
   * Поставити або прибрати лайк
   */
  async toggleLike(userId: number, exerciseId: number) {
    const condition = and(
      eq(exerciseLikes.userId, userId),
      eq(exerciseLikes.exerciseId, exerciseId),
    );
    const removed = await db.delete(exerciseLikes).where(condition).returning();
    if (!removed.length) {
      await db.insert(exerciseLikes).values({ userId, exerciseId }).onConflictDoNothing();
    }
    return { isLiked: !removed.length };
  }
}
