// EN: Implements exercise catalog reads and ownership-aware mutations, including atomic muscle roles, media, reactions, and outbox events.
// UK: Реалізує читання каталогу вправ і зміни з перевіркою власника, включно з атомарними ролями м'язів, медіа, реакціями та подіями outbox.

import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
  exercises,
  exerciseTranslations,
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
import type { DbTransaction } from '../outbox/transaction';
import { OutboxService } from '../outbox/outbox.service';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly storageService: StorageService,
    private readonly outbox: OutboxService,
  ) {}

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
        catalogKey: exercises.catalogKey,
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
        catalogKey: exercises.catalogKey,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        imageKey: exercises.imageKey,
        difficulty: exercises.difficulty,
        measurementType: exercises.measurementType,
        recommendedDurationSeconds: exercises.recommendedDurationSeconds,
        recommendedSets: exercises.recommendedSets,
        recommendedReps: exercises.recommendedReps,
        equipment: exercises.equipment,
        equipmentStructured: exercises.equipmentStructured,
        demonstrationImageKey: exercises.demonstrationImageKey,
        demonstrationImageSourceUrl: exercises.demonstrationImageSourceUrl,
        demonstrationImageAuthor: exercises.demonstrationImageAuthor,
        demonstrationImageLicense: exercises.demonstrationImageLicense,
        demonstrationImageLicenseUrl: exercises.demonstrationImageLicenseUrl,
        muscleId: muscles.id,
        muscleRole: exercisesTrainMuscles.role,
        muscleCommonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(
        exercisesTrainMuscles,
        eq(exercises.id, exercisesTrainMuscles.exerciseId),
      )
      .leftJoin(muscles, eq(exercisesTrainMuscles.muscleId, muscles.id));

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
    const bookmarked = currentUserId
      ? await db
          .select({ exerciseId: exerciseBookmarks.exerciseId })
          .from(exerciseBookmarks)
          .where(eq(exerciseBookmarks.userId, currentUserId))
      : [];
    const bookmarks = new Set(bookmarked.map((row) => row.exerciseId));
    if (currentUserId) {
      const userLikesData = await db
        .select({ exerciseId: exerciseLikes.exerciseId })
        .from(exerciseLikes)
        .where(eq(exerciseLikes.userId, currentUserId));

      userLikesData.forEach((row) => userLikesSet.add(row.exerciseId));
    }

    // 4. Формуємо фінальний результат з масивом `muscles`
    type ExerciseWithMuscles = {
      id: number;
      catalogKey: string | null;
      name: string;
      description: string | null;
      videoUrl: string | null;
      imageKey: string | null;
      difficulty: number;
      measurementType: 'reps' | 'duration';
      recommendedDurationSeconds: number | null;
      recommendedSets: number | null;
      recommendedReps: number | null;
      equipment: string[];
      equipmentStructured: { required: string[]; alternatives: string[][] };
      demonstrationImageKey: string | null;
      demonstrationImageSourceUrl: string | null;
      demonstrationImageAuthor: string | null;
      demonstrationImageLicense: string | null;
      demonstrationImageLicenseUrl: string | null;
      translations: Array<{
        locale: string;
        name: string;
        description: string | null;
        videoUrl: string | null;
        aliases: string[];
      }>;
      likesCount: number;
      isLiked: boolean;
      isBookmarked: boolean;
      muscles: Array<{
        id: number;
        name: string | null;
        commonName: string | null;
        scientificName: string | null;
        role: string;
      }>;
    };
    const exercisesMap = new Map<number, ExerciseWithMuscles>();

    for (const row of rows) {
      if (!exercisesMap.has(row.id)) {
        exercisesMap.set(row.id, {
          id: row.id,
          catalogKey: row.catalogKey,
          name: row.name,
          description: row.description,
          videoUrl: row.videoUrl,
          imageKey: row.imageKey,
          difficulty: row.difficulty,
          measurementType: row.measurementType,
          recommendedDurationSeconds: row.recommendedDurationSeconds,
          recommendedSets: row.recommendedSets,
          recommendedReps: row.recommendedReps,
          equipment: row.equipment,
          equipmentStructured: row.equipmentStructured,
          demonstrationImageKey: row.demonstrationImageKey,
          demonstrationImageSourceUrl: row.demonstrationImageSourceUrl,
          demonstrationImageAuthor: row.demonstrationImageAuthor,
          demonstrationImageLicense: row.demonstrationImageLicense,
          demonstrationImageLicenseUrl: row.demonstrationImageLicenseUrl,
          translations: [],
          likesCount: likesMap.get(row.id) || 0,
          isLiked: userLikesSet.has(row.id),
          isBookmarked: bookmarks.has(row.id),
          muscles: [], // Масив об'єктів м'язів, який очікує фронтенд
        });
      }

      if (row.muscleId !== null) {
        const currentMuscles = exercisesMap.get(row.id)!.muscles;
        const exists = currentMuscles.some((m) => m.id === row.muscleId);

        if (!exists) {
          currentMuscles.push({
            id: row.muscleId,
            name: row.muscleCommonName,
            commonName: row.muscleCommonName,
            scientificName: row.scientificName,
            role: row.muscleRole as 'primary' | 'secondary',
          });
        }
      }
    }

    const translations = exercisesMap.size
      ? await db
          .select({
            exerciseId: exerciseTranslations.exerciseId,
            locale: exerciseTranslations.locale,
            name: exerciseTranslations.name,
            description: exerciseTranslations.description,
            videoUrl: exerciseTranslations.videoUrl,
            aliases: exerciseTranslations.aliases,
          })
          .from(exerciseTranslations)
          .where(
            inArray(exerciseTranslations.exerciseId, [...exercisesMap.keys()]),
          )
      : [];
    for (const translation of translations) {
      exercisesMap.get(translation.exerciseId)?.translations.push({
        locale: translation.locale,
        name: translation.name,
        description: translation.description,
        videoUrl: translation.videoUrl,
        aliases: translation.aliases,
      });
    }

    // Presigning is a local HMAC, so signing a whole page costs no round trips.
    return Promise.all(
      Array.from(exercisesMap.values()).map((exercise) =>
        this.withMediaUrls(exercise),
      ),
    );
  }

  async getSharedExerciseById(id: number) {
    const rows = await db
      .select({
        id: exercises.id,
        catalogKey: exercises.catalogKey,
        name: exercises.name,
        description: exercises.description,
        videoUrl: exercises.videoUrl,
        imageKey: exercises.imageKey,
        difficulty: exercises.difficulty,
        measurementType: exercises.measurementType,
        recommendedDurationSeconds: exercises.recommendedDurationSeconds,
        recommendedSets: exercises.recommendedSets,
        recommendedReps: exercises.recommendedReps,
        equipment: exercises.equipment,
        equipmentStructured: exercises.equipmentStructured,
        demonstrationImageKey: exercises.demonstrationImageKey,
        demonstrationImageSourceUrl: exercises.demonstrationImageSourceUrl,
        demonstrationImageAuthor: exercises.demonstrationImageAuthor,
        demonstrationImageLicense: exercises.demonstrationImageLicense,
        demonstrationImageLicenseUrl: exercises.demonstrationImageLicenseUrl,
        muscleId: muscles.id,
        muscleRole: exercisesTrainMuscles.role,
        muscleCommonName: muscles.commonName,
        scientificName: muscles.scientificName,
      })
      .from(exercises)
      .leftJoin(
        exercisesTrainMuscles,
        eq(exercises.id, exercisesTrainMuscles.exerciseId),
      )
      .leftJoin(muscles, eq(exercisesTrainMuscles.muscleId, muscles.id))
      .where(eq(exercises.id, id));

    if (!rows.length) throw new NotFoundException('Exercise not found');
    const exercise = rows[0];
    const translations = await db
      .select({
        locale: exerciseTranslations.locale,
        name: exerciseTranslations.name,
        description: exerciseTranslations.description,
        videoUrl: exerciseTranslations.videoUrl,
        aliases: exerciseTranslations.aliases,
      })
      .from(exerciseTranslations)
      .where(eq(exerciseTranslations.exerciseId, id));
    return this.withMediaUrls({
      id: exercise.id,
      catalogKey: exercise.catalogKey,
      name: exercise.name,
      description: exercise.description,
      videoUrl: exercise.videoUrl,
      imageKey: exercise.imageKey,
      difficulty: exercise.difficulty,
      measurementType: exercise.measurementType,
      recommendedDurationSeconds: exercise.recommendedDurationSeconds,
      recommendedSets: exercise.recommendedSets,
      recommendedReps: exercise.recommendedReps,
      equipment: exercise.equipment,
      equipmentStructured: exercise.equipmentStructured,
      demonstrationImageKey: exercise.demonstrationImageKey,
      demonstrationImageSourceUrl: exercise.demonstrationImageSourceUrl,
      demonstrationImageAuthor: exercise.demonstrationImageAuthor,
      demonstrationImageLicense: exercise.demonstrationImageLicense,
      demonstrationImageLicenseUrl: exercise.demonstrationImageLicenseUrl,
      translations,
      muscles: rows.flatMap((row) =>
        row.muscleId === null
          ? []
          : [
              {
                id: row.muscleId,
                name: row.muscleCommonName,
                commonName: row.muscleCommonName,
                scientificName: row.scientificName,
                role: row.muscleRole as 'primary' | 'secondary',
              },
            ],
      ),
    });
  }

  async getMediaSources(locale: 'en' | 'uk') {
    const rows = await db
      .select({
        id: exercises.id,
        name: exercises.name,
        demonstrationImageKey: exercises.demonstrationImageKey,
        sourceUrl: exercises.demonstrationImageSourceUrl,
        author: exercises.demonstrationImageAuthor,
        license: exercises.demonstrationImageLicense,
        licenseUrl: exercises.demonstrationImageLicenseUrl,
      })
      .from(exercises)
      .where(sql`${exercises.demonstrationImageKey} is not null`);
    if (!rows.length) return [];
    const translations = await db
      .select({
        exerciseId: exerciseTranslations.exerciseId,
        locale: exerciseTranslations.locale,
        name: exerciseTranslations.name,
      })
      .from(exerciseTranslations)
      .where(
        and(
          inArray(
            exerciseTranslations.exerciseId,
            rows.map(({ id }) => id),
          ),
          inArray(exerciseTranslations.locale, [locale, 'en']),
        ),
      );
    const names = new Map<number, string>();
    for (const translation of translations) {
      if (translation.locale === locale || !names.has(translation.exerciseId))
        names.set(translation.exerciseId, translation.name);
    }
    return Promise.all(
      rows.map(async ({ demonstrationImageKey, ...row }) => ({
        ...row,
        name: names.get(row.id) ?? row.name,
        imageUrl: await this.storageService.getUrl(demonstrationImageKey),
      })),
    ).then((items) =>
      items.sort((left, right) => left.name.localeCompare(right.name, locale)),
    );
  }

  /**
   * EN: Resolves one complete catalog record for authenticated detail views.
   * UK: Отримує один повний запис каталогу для автентифікованих екранів деталей.
   */
  async getExerciseById(id: number) {
    return this.getSharedExerciseById(id);
  }

  /**
   * Створення вправи
   */
  async createExercise(data: CreateExerciseDto) {
    this.validateCatalogData(data);
    // EN: Omitted role lists keep the legacy creation contract and mean "no muscle links"; supplied IDs are persisted with an explicit role.
    // UK: Відсутні списки ролей зберігають старий контракт створення й означають «без зв'язків із м'язами»; передані ID зберігаються з явною роллю.
    const primaryMuscleIds = data.primaryMuscleIds ?? [];
    const secondaryMuscleIds = data.secondaryMuscleIds ?? [];
    // EN: One muscle cannot occupy both roles because consumers group workload and history by this mutually exclusive classification.
    // UK: Один м'яз не може мати обидві ролі, бо споживачі групують навантаження та історію за цією взаємовиключною класифікацією.
    if (primaryMuscleIds.some((id) => secondaryMuscleIds.includes(id))) {
      throw new BadRequestException({
        message: 'A muscle cannot be both primary and secondary.',
        code: 'EXERCISE_MUSCLE_ROLE_CONFLICT',
      });
    }
    const trimmedName = data.name.trim();
    if (
      data.measurementType !== 'duration' &&
      data.recommendedDurationSeconds !== undefined
    ) {
      throw new BadRequestException(
        'recommendedDurationSeconds requires duration measurement',
      );
    }

    const existing = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(ilike(exercises.name, trimmedName))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(
        `Exercise "${trimmedName}" already exists in the database.`,
      );
    }

    // The pre-check gives a friendly error; the unique index on name is what
    // actually decides a race between two identical creates.
    return db
      .transaction(async (tx: DbTransaction) => {
        const [newExercise] = await tx
          .insert(exercises)
          .values({
            name: trimmedName,
            catalogKey: data.catalogKey?.trim() || null,
            description: data.description?.trim() || null,
            videoUrl: data.videoUrl?.trim() || null,
            difficulty: data.difficulty || 1,
            measurementType: data.measurementType ?? 'reps',
            recommendedDurationSeconds:
              data.measurementType === 'reps'
                ? null
                : (data.recommendedDurationSeconds ?? null),
            recommendedSets: data.recommendedSets ?? null,
            recommendedReps:
              data.measurementType === 'duration'
                ? null
                : (data.recommendedReps ?? null),
            equipment: data.equipment ?? [],
            equipmentStructured: data.equipmentStructured ?? {
              required: [],
              alternatives: [],
            },
            demonstrationImageSourceUrl:
              data.demonstrationImageSourceUrl?.trim() || null,
            demonstrationImageAuthor:
              data.demonstrationImageAuthor?.trim() || null,
            demonstrationImageLicense:
              data.demonstrationImageLicense?.trim() || null,
            demonstrationImageLicenseUrl:
              data.demonstrationImageLicenseUrl?.trim() || null,
          })
          .returning();

        if (primaryMuscleIds.length || secondaryMuscleIds.length) {
          const relations = [
            ...primaryMuscleIds.map((muscleId) => ({
              exerciseId: newExercise.id,
              muscleId,
              role: 'primary' as const,
            })),
            ...secondaryMuscleIds.map((muscleId) => ({
              exerciseId: newExercise.id,
              muscleId,
              role: 'secondary' as const,
            })),
          ];
          await tx.insert(exercisesTrainMuscles).values(relations);
        }

        const translations = data.translations?.length
          ? data.translations
          : [
              {
                locale: 'en',
                name: newExercise.name,
                description: newExercise.description ?? undefined,
                videoUrl: newExercise.videoUrl ?? undefined,
              },
            ];
        if (translations.length) {
          await tx.insert(exerciseTranslations).values(
            translations.map((translation) => ({
              exerciseId: newExercise.id,
              locale: translation.locale,
              name: translation.name.trim(),
              description: translation.description?.trim() || null,
              videoUrl: translation.videoUrl?.trim() || null,
              aliases: (translation.aliases ?? []).map((alias) => alias.trim()),
            })),
          );
        }

        await this.enqueueSearchChange(tx, newExercise.id);

        return {
          ...newExercise,
          primaryMuscleIds,
          secondaryMuscleIds,
        };
      })
      .then(
        (created) => this.withImageUrl(created),
        (error: unknown) => {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '23505'
          ) {
            throw new ConflictException(
              `Exercise "${trimmedName}" already exists in the database.`,
            );
          }
          throw error;
        },
      );
  }

  async updateExercise(id: number, data: UpdateExerciseDto) {
    this.validateCatalogData(data);
    const { primaryMuscleIds, secondaryMuscleIds, ...exercise } = data;
    // EN: Omitting both lists preserves existing links; providing either list switches to full replacement and therefore requires both.
    // UK: Відсутність обох списків зберігає наявні зв'язки; передавання хоча б одного вмикає повну заміну, тому потрібні обидва.
    const changesMuscles =
      primaryMuscleIds !== undefined || secondaryMuscleIds !== undefined;
    if (
      changesMuscles &&
      (primaryMuscleIds === undefined || secondaryMuscleIds === undefined)
    ) {
      throw new BadRequestException({
        message: 'Primary and secondary muscle lists must be updated together.',
        code: 'EXERCISE_MUSCLE_GROUPS_INCOMPLETE',
      });
    }
    if (primaryMuscleIds?.some((id) => secondaryMuscleIds!.includes(id))) {
      throw new BadRequestException({
        message: 'A muscle cannot be both primary and secondary.',
        code: 'EXERCISE_MUSCLE_ROLE_CONFLICT',
      });
    }
    const changes = {
      ...(exercise.name !== undefined ? { name: exercise.name.trim() } : {}),
      ...(exercise.description !== undefined
        ? { description: exercise.description.trim() || null }
        : {}),
      ...(exercise.videoUrl !== undefined
        ? { videoUrl: exercise.videoUrl.trim() || null }
        : {}),
      ...(exercise.difficulty !== undefined
        ? { difficulty: exercise.difficulty }
        : {}),
      ...(exercise.measurementType !== undefined
        ? { measurementType: exercise.measurementType }
        : {}),
      ...(exercise.recommendedDurationSeconds !== undefined
        ? { recommendedDurationSeconds: exercise.recommendedDurationSeconds }
        : {}),
      ...(exercise.recommendedSets !== undefined
        ? { recommendedSets: exercise.recommendedSets }
        : {}),
      ...(exercise.recommendedReps !== undefined
        ? { recommendedReps: exercise.recommendedReps }
        : {}),
      ...(exercise.equipmentStructured !== undefined
        ? { equipmentStructured: exercise.equipmentStructured }
        : {}),
      ...(exercise.equipment !== undefined
        ? { equipment: exercise.equipment }
        : {}),
      ...(exercise.demonstrationImageSourceUrl !== undefined
        ? {
            demonstrationImageSourceUrl:
              exercise.demonstrationImageSourceUrl.trim() || null,
          }
        : {}),
      ...(exercise.demonstrationImageAuthor !== undefined
        ? {
            demonstrationImageAuthor:
              exercise.demonstrationImageAuthor.trim() || null,
          }
        : {}),
      ...(exercise.demonstrationImageLicense !== undefined
        ? {
            demonstrationImageLicense:
              exercise.demonstrationImageLicense.trim() || null,
          }
        : {}),
      ...(exercise.demonstrationImageLicenseUrl !== undefined
        ? {
            demonstrationImageLicenseUrl:
              exercise.demonstrationImageLicenseUrl.trim() || null,
          }
        : {}),
    };
    if (exercise.measurementType === 'reps') {
      changes.recommendedDurationSeconds = null;
    } else if (exercise.measurementType === 'duration') {
      changes.recommendedReps = null;
    }
    if (
      exercise.measurementType === 'reps' &&
      exercise.recommendedDurationSeconds !== undefined &&
      exercise.recommendedDurationSeconds !== null
    ) {
      throw new BadRequestException(
        'recommendedDurationSeconds requires duration measurement',
      );
    }

    try {
      return await db
        .transaction(async (tx: DbTransaction) => {
          let updated: typeof exercises.$inferSelect | undefined;
          if (Object.keys(changes).length) {
            [updated] = await tx
              .update(exercises)
              .set(changes)
              .where(eq(exercises.id, id))
              .returning();
          } else {
            [updated] = await tx
              .select()
              .from(exercises)
              .where(eq(exercises.id, id))
              .limit(1);
          }
          if (!updated) throw new NotFoundException('Exercise not found');
          if (
            updated.measurementType === 'reps' &&
            updated.recommendedDurationSeconds !== null
          ) {
            [updated] = await tx
              .update(exercises)
              .set({ recommendedDurationSeconds: null })
              .where(eq(exercises.id, id))
              .returning();
          }

          if (changesMuscles) {
            // EN: Delete-and-insert runs in the same transaction, so readers never observe a partially replaced primary/secondary assignment.
            // UK: Видалення й вставлення виконуються в одній транзакції, тому читачі не побачать частково заміненого розподілу основних і допоміжних м'язів.
            await tx
              .delete(exercisesTrainMuscles)
              .where(eq(exercisesTrainMuscles.exerciseId, id));
            const primary = primaryMuscleIds ?? [];
            const secondary = secondaryMuscleIds ?? [];
            if (primary.length || secondary.length) {
              await tx.insert(exercisesTrainMuscles).values([
                ...primary.map((muscleId) => ({
                  exerciseId: id,
                  muscleId,
                  role: 'primary' as const,
                })),
                ...secondary.map((muscleId) => ({
                  exerciseId: id,
                  muscleId,
                  role: 'secondary' as const,
                })),
              ]);
            }
          }

          if (data.translations !== undefined) {
            const locales = data.translations.map(
              (translation) => translation.locale,
            );
            await tx
              .delete(exerciseTranslations)
              .where(eq(exerciseTranslations.exerciseId, id));
            if (data.translations.length) {
              await tx.insert(exerciseTranslations).values(
                data.translations.map((translation) => ({
                  exerciseId: id,
                  locale: translation.locale,
                  name: translation.name.trim(),
                  description: translation.description?.trim() || null,
                  videoUrl: translation.videoUrl?.trim() || null,
                  aliases: (translation.aliases ?? []).map((alias) =>
                    alias.trim(),
                  ),
                })),
              );
            }
            void locales;
          } else if (
            data.name !== undefined ||
            data.description !== undefined ||
            data.videoUrl !== undefined
          ) {
            await tx
              .insert(exerciseTranslations)
              .values({
                exerciseId: id,
                locale: 'en',
                name: updated.name,
                description: updated.description,
                videoUrl: updated.videoUrl,
                aliases: [],
              })
              .onConflictDoUpdate({
                target: [
                  exerciseTranslations.exerciseId,
                  exerciseTranslations.locale,
                ],
                set: {
                  name: updated.name,
                  description: updated.description,
                  videoUrl: updated.videoUrl,
                },
              });
          }

          await this.enqueueSearchChange(tx, id);

          return { ...updated, primaryMuscleIds, secondaryMuscleIds };
        })
        .then((result) => this.withImageUrl(result));
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException(
          `Exercise "${changes.name}" already exists in the database.`,
        );
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

  async setDemonstrationImage(
    exerciseId: number,
    file: UploadedFile | undefined,
  ) {
    const stored = await this.storageService.uploadImage({
      scope: 'exercises',
      ownerId: exerciseId,
      file,
      maxDimension: this.storageService.limits.exerciseImageMaxDimension,
    });
    let replacedKey: string | null;
    try {
      replacedKey = await this.setDemonstrationImageKey(exerciseId, stored.key);
    } catch (error) {
      await this.storageService.remove(stored.key);
      throw error;
    }
    await this.storageService.remove(replacedKey);
    return this.getSharedExerciseById(exerciseId);
  }

  async removeDemonstrationImage(exerciseId: number) {
    const replacedKey = await this.setDemonstrationImageKey(exerciseId, null);
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

      await this.enqueueSearchChange(tx, exerciseId);

      return current.imageKey === imageKey ? null : current.imageKey;
    });
  }

  private async setDemonstrationImageKey(
    exerciseId: number,
    demonstrationImageKey: string | null,
  ): Promise<string | null> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ demonstrationImageKey: exercises.demonstrationImageKey })
        .from(exercises)
        .where(eq(exercises.id, exerciseId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('Exercise not found');
      await tx
        .update(exercises)
        .set({ demonstrationImageKey })
        .where(eq(exercises.id, exerciseId));
      await this.enqueueSearchChange(tx, exerciseId);
      return current.demonstrationImageKey === demonstrationImageKey
        ? null
        : current.demonstrationImageKey;
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

  private async withMediaUrls<
    T extends {
      imageKey?: string | null;
      demonstrationImageKey?: string | null;
    },
  >(row: T) {
    const { imageKey, demonstrationImageKey, ...rest } = row;
    const [imageUrl, demonstrationImageUrl] = await Promise.all([
      this.storageService.getUrl(imageKey),
      this.storageService.getUrl(demonstrationImageKey),
    ]);
    return { ...rest, imageUrl, demonstrationImageUrl };
  }

  async toggleBookmark(userId: number, exerciseId: number) {
    const [exercise] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(eq(exercises.id, exerciseId))
      .limit(1);
    if (!exercise) throw new NotFoundException('Exercise not found');
    const removed = await db
      .delete(exerciseBookmarks)
      .where(
        and(
          eq(exerciseBookmarks.userId, userId),
          eq(exerciseBookmarks.exerciseId, exerciseId),
        ),
      )
      .returning();
    if (!removed.length)
      await db
        .insert(exerciseBookmarks)
        .values({ userId, exerciseId })
        .onConflictDoNothing();
    return { isBookmarked: !removed.length };
  }

  /**
   * Поставити або прибрати лайк
   */
  async toggleLike(userId: number, exerciseId: number) {
    return db.transaction(async (tx: DbTransaction) => {
      const condition = and(
        eq(exerciseLikes.userId, userId),
        eq(exerciseLikes.exerciseId, exerciseId),
      );
      const removed = await tx
        .delete(exerciseLikes)
        .where(condition)
        .returning();
      if (!removed.length) {
        await tx
          .insert(exerciseLikes)
          .values({ userId, exerciseId })
          .onConflictDoNothing();
      }
      await this.enqueueSearchChange(tx, exerciseId);
      return { isLiked: !removed.length };
    });
  }

  private enqueueSearchChange(tx: DbTransaction, exerciseId: number) {
    return this.outbox.enqueue(tx, {
      type: 'catalog.exercise.changed',
      aggregateId: exerciseId,
      payload: { exerciseId, change: 'upsert' },
    });
  }

  private validateCatalogData(data: CreateExerciseDto | UpdateExerciseDto) {
    const translations = data.translations;
    if (translations) {
      const locales = translations.map((translation) => translation.locale);
      if (new Set(locales).size !== locales.length) {
        throw new BadRequestException('Translation locales must be unique.');
      }
      if (
        translations.some(
          (translation) =>
            !translation.name.trim() ||
            (translation.aliases ?? []).some((alias) => !alias.trim()),
        )
      ) {
        throw new BadRequestException(
          'Translation names and aliases must be non-blank.',
        );
      }
    }
    const structured = data.equipmentStructured;
    if (structured) {
      if (
        !Array.isArray(structured.required) ||
        structured.required.some(
          (item) => typeof item !== 'string' || !item.trim(),
        )
      ) {
        throw new BadRequestException(
          'Equipment required items must be non-blank strings.',
        );
      }
      if (
        !Array.isArray(structured.alternatives) ||
        structured.alternatives.some(
          (group) =>
            !Array.isArray(group) ||
            group.length === 0 ||
            group.some((item) => typeof item !== 'string' || !item.trim()),
        )
      ) {
        throw new BadRequestException(
          'Equipment alternatives must be non-empty groups of non-blank strings.',
        );
      }
    }
  }
}
