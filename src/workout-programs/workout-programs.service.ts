// EN: Implements ownership-aware program libraries, content, recurring schedules, sharing, matching, reactions, media, and transactional events.
// UK: Реалізує бібліотеки програм з перевіркою власника, вміст, повторювані розклади, поширення, підбір, реакції, медіа та транзакційні події.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db';
import {
  exerciseInPrograms,
  exerciseTranslations,
  exercises,
  programContent,
  users,
  userProgramSchedule,
  userProgramScheduleSeries,
  workouts,
  workoutPrograms,
  workoutProgramTranslations,
  programLikes,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import {
  CreateWorkoutProgramDto,
  ProgramExerciseDto,
} from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import {
  ListScheduleDto,
  ScheduleProgramDto,
} from './dto/schedule-program.dto';
import { scheduleStatus } from './schedule.utils';
import { materializeWeeklyAssignments } from './materialize-weekly-assignments';
import { hasSameExerciseMultiset } from './sharing.utils';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';
import { OutboxService } from '../outbox/outbox.service';
import type { DbTransaction } from '../outbox/transaction';

@Injectable()
export class WorkoutProgramsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  async createPersonalProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, true, dto);
  }

  async createOfficialProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, false, dto);
  }

  async findMatchingProgramByExerciseIds(
    userId: number,
    exerciseIds: number[],
  ) {
    const program = await this.findMatchingProgram(
      userId,
      exerciseIds.map((exerciseId) => ({ exerciseId })),
      true,
    );
    return {
      programId: program?.id ?? null,
      programName: program?.name ?? null,
      isPersonal: program?.isPersonal ?? null,
    };
  }

  async copyAsPersonalProgram(
    userId: number,
    role: UserRole,
    sourceId: number,
    dto: CreateWorkoutProgramDto,
  ) {
    const [source] = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, sourceId))
      .limit(1);
    if (!source) throw new NotFoundException('Workout program not found');
    if (source.isPersonal && source.createdById !== userId) {
      throw new ForbiddenException('Personal programs cannot be copied');
    }
    if (
      !source.isPersonal &&
      !source.isActive &&
      !hasMinimumRole(role, 'moderator')
    ) {
      throw new NotFoundException('Workout program not found');
    }
    return this.createPersonalProgram(userId, dto);
  }

  async createShareToken(userId: number, role: UserRole, programId: number) {
    const accessible = await this.getProgramById(programId, userId, role);
    if (accessible.isPersonal && accessible.createdById !== userId) {
      throw new ForbiddenException(
        'Only the owner can share a personal program',
      );
    }

    const [program] = await db
      .select({ shareToken: workoutPrograms.shareToken })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (program.shareToken) return { token: program.shareToken };

    const token = randomUUID();
    // EN: The conditional update elects one token during concurrent share requests; losers re-read the winner instead of overwriting it.
    // UK: Умовне оновлення обирає один токен за конкурентних запитів поширення; інші запити повторно читають переможне значення, а не перезаписують його.
    const [updated] = await db
      .update(workoutPrograms)
      .set({ shareToken: token })
      .where(
        and(
          eq(workoutPrograms.id, programId),
          isNull(workoutPrograms.shareToken),
        ),
      )
      .returning({ shareToken: workoutPrograms.shareToken });
    if (updated?.shareToken) return { token: updated.shareToken };

    const [current] = await db
      .select({ shareToken: workoutPrograms.shareToken })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (!current?.shareToken)
      throw new NotFoundException('Workout program not found');
    return { token: current.shareToken };
  }

  async getSharedProgram(token: string) {
    const source = await this.findSharedProgram(token);
    const { createdById, ...program } = source;
    void createdById;
    const [localizedProgram] = await this.withProgramTranslations([
      await this.withImageUrl(program),
    ]);
    return {
      ...localizedProgram,
      schedule: await this.getSchedule(source.id),
    };
  }

  async importSharedProgram(userId: number, token: string) {
    const source = await this.findSharedProgram(token);
    if (!source.isPersonal || source.createdById === userId) {
      return { programId: source.id, imported: false, alreadyImported: true };
    }

    const findExisting = async () => {
      const [existing] = await db
        .select({ id: workoutPrograms.id })
        .from(workoutPrograms)
        .where(
          and(
            eq(workoutPrograms.createdById, userId),
            eq(workoutPrograms.sourceProgramId, source.id),
          ),
        )
        .limit(1);
      return existing;
    };
    const existing = await findExisting();
    if (existing)
      return { programId: existing.id, imported: false, alreadyImported: true };

    try {
      const exercises = await this.getScheduleExercises(db, source.id);
      const matchingProgramId = await this.findMatchingPersonalProgram(
        userId,
        exercises,
      );
      if (matchingProgramId) {
        return {
          programId: matchingProgramId,
          imported: false,
          alreadyImported: true,
        };
      }
      const program = await this.createProgram(
        userId,
        true,
        {
          name: source.name,
          description: source.description ?? undefined,
          exercises,
        },
        source.id,
      );
      return { programId: program.id, imported: true, alreadyImported: false };
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ))
        throw error;
      const raced = await findExisting();
      if (!raced) throw error;
      return { programId: raced.id, imported: false, alreadyImported: true };
    }
  }

  async scheduleProgram(
    userId: number,
    role: UserRole,
    dto: ScheduleProgramDto,
  ) {
    await this.getProgramById(dto.programId, userId, role);
    const weekly = dto.repeat === 'weekly';

    // EN: The schedule row or series and its outbox event commit together, keeping calendar materialization and downstream notifications consistent.
    // UK: Рядок або серія розкладу та подія outbox фіксуються разом, зберігаючи узгодженість календаря й подальших сповіщень.
    return db.transaction(async (tx: DbTransaction) => {
      const series = weekly
        ? (
            await tx
              .insert(userProgramScheduleSeries)
              .values({
                userId,
                programId: dto.programId,
                startsOn: dto.scheduledFor,
                endsOn: dto.repeatUntil ?? null,
              })
              .returning()
          )[0]
        : null;
      // The unique (user, date, program) index makes a retried request a no-op.
      const assignments = await tx
        .insert(userProgramSchedule)
        .values({
          userId,
          programId: dto.programId,
          scheduledFor: dto.scheduledFor,
          seriesId: series?.id ?? null,
        })
        .onConflictDoNothing()
        .returning();
      const operationAssignments = await tx
        .select({
          id: userProgramSchedule.id,
          scheduledFor: userProgramSchedule.scheduledFor,
        })
        .from(userProgramSchedule)
        .where(
          and(
            eq(userProgramSchedule.userId, userId),
            eq(userProgramSchedule.programId, dto.programId),
            eq(userProgramSchedule.scheduledFor, dto.scheduledFor),
          ),
        );

      if (series || assignments.length) {
        await this.outbox.enqueue(tx, {
          type: 'program.scheduled',
          aggregateId: userId,
          payload: {
            userId,
            programId: dto.programId,
            scheduledFor: dto.scheduledFor,
            repeat: weekly ? 'weekly' : 'none',
            repeatUntil: weekly ? (dto.repeatUntil ?? null) : null,
            seriesId: series?.id ?? null,
            scheduleIds: assignments.map(
              (assignment: { id: number }) => assignment.id,
            ),
            assignments: operationAssignments.map((assignment) => ({
              scheduleId: assignment.id,
              scheduledFor: assignment.scheduledFor,
            })),
          },
        });
      }
      return assignments;
    });
  }

  async getCalendar(userId: number, { from, to }: ListScheduleDto) {
    const today = new Date().toISOString().slice(0, 10);
    // The read runs in the same transaction as the materialization below, so
    // it reaches the primary too: a plain `db.select` here could hit a
    // lagging replica and miss the rows this request just inserted.
    const assignments = await db.transaction(async (tx: DbTransaction) => {
      await materializeWeeklyAssignments(tx, this.outbox, userId, from, to);
      return tx
        .select({
          id: userProgramSchedule.id,
          scheduledFor: userProgramSchedule.scheduledFor,
          storedStatus: userProgramSchedule.status,
          programId: workoutPrograms.id,
          programName: workoutPrograms.name,
          programDescription: workoutPrograms.description,
          isPersonal: workoutPrograms.isPersonal,
          seriesId: userProgramSchedule.seriesId,
          completedAt: workouts.finishedAt,
        })
        .from(userProgramSchedule)
        .innerJoin(
          workoutPrograms,
          eq(userProgramSchedule.programId, workoutPrograms.id),
        )
        .leftJoin(
          workouts,
          and(
            eq(workouts.scheduleId, userProgramSchedule.id),
            eq(workouts.status, 'completed'),
          ),
        )
        .where(
          and(
            eq(userProgramSchedule.userId, userId),
            gte(userProgramSchedule.scheduledFor, from),
            lte(userProgramSchedule.scheduledFor, to),
          ),
        )
        .orderBy(
          asc(userProgramSchedule.scheduledFor),
          asc(userProgramSchedule.id),
        );
    });

    return assignments.map(({ storedStatus, ...assignment }) => ({
      ...assignment,
      status: scheduleStatus(storedStatus, assignment.scheduledFor, today),
    }));
  }

  async removeScheduledProgram(userId: number, id: number) {
    await db.transaction(async (tx: DbTransaction) => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const [assignment] = await tx
        .select({ seriesId: userProgramSchedule.seriesId })
        .from(userProgramSchedule)
        .where(
          and(
            eq(userProgramSchedule.id, id),
            eq(userProgramSchedule.userId, userId),
          ),
        )
        .for('update')
        .limit(1);
      if (!assignment)
        throw new NotFoundException('Scheduled workout not found');

      let removed: { id: number }[];
      if (assignment.seriesId) {
        // EN: Keep completed slots linked to their workout and retain past plan history.
        // UK: Зберігає зв’язок завершених записів із тренуванням та історію минулого плану.
        const [series] = await tx
          .select({
            startsOn: userProgramScheduleSeries.startsOn,
            endsOn: userProgramScheduleSeries.endsOn,
          })
          .from(userProgramScheduleSeries)
          .where(eq(userProgramScheduleSeries.id, assignment.seriesId))
          .for('update');
        removed = await tx
          .delete(userProgramSchedule)
          .where(
            and(
              eq(userProgramSchedule.seriesId, assignment.seriesId),
              gte(userProgramSchedule.scheduledFor, today),
              notExists(
                tx
                  .select({ id: workouts.id })
                  .from(workouts)
                  .where(
                    and(
                      eq(workouts.scheduleId, userProgramSchedule.id),
                      eq(workouts.status, 'completed'),
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: userProgramSchedule.id });
        if (series.startsOn >= today) {
          await tx
            .update(userProgramSchedule)
            .set({ seriesId: null })
            .where(eq(userProgramSchedule.seriesId, assignment.seriesId));
          await tx
            .delete(userProgramScheduleSeries)
            .where(eq(userProgramScheduleSeries.id, assignment.seriesId));
        } else {
          await tx
            .update(userProgramScheduleSeries)
            .set({
              endsOn:
                series.endsOn && series.endsOn < yesterday
                  ? series.endsOn
                  : yesterday,
            })
            .where(eq(userProgramScheduleSeries.id, assignment.seriesId));
        }
      } else {
        await tx
          .delete(userProgramSchedule)
          .where(eq(userProgramSchedule.id, id));
        removed = [{ id }];
      }
      if (removed.length) {
        await this.outbox.enqueue(tx, {
          type: 'program.unscheduled',
          aggregateId: userId,
          payload: { userId, scheduleIds: removed.map((item) => item.id) },
        });
      }
    });
  }

  async updateProgram(
    userId: number,
    role: UserRole,
    id: number,
    dto: UpdateWorkoutProgramDto,
  ) {
    const [program] = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, id))
      .limit(1);
    if (!program) throw new NotFoundException('Workout program not found');

    if (program.isPersonal) {
      if (program.createdById !== userId) {
        throw new ForbiddenException(
          'Personal programs can only be edited by their owner',
        );
      }
      return this.updatePersonalProgram(id, dto);
    }

    if (!hasMinimumRole(role, 'moderator')) {
      throw new ForbiddenException(
        'Only moderators can edit official programs',
      );
    }
    return this.createOfficialRevision(userId, program, dto);
  }

  async setImage(programId: number, file: UploadedFile | undefined) {
    const [program] = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (!program) throw new NotFoundException('Workout program not found');
    if (program.isPersonal)
      throw new ForbiddenException(
        'Only official programs can have managed images',
      );

    const stored = await this.storageService.uploadImage({
      scope: 'programs',
      ownerId: programId,
      file,
      maxDimension: this.storageService.limits.exerciseImageMaxDimension,
    });

    let replacedKey: string | null;
    try {
      replacedKey = await this.setImageKey(programId, stored.key);
    } catch (error) {
      await this.storageService.remove(stored.key);
      throw error;
    }
    await this.storageService.remove(replacedKey);
    return this.getProgramById(programId, 0, 'moderator');
  }

  async removeImage(programId: number) {
    const [program] = await db
      .select({
        id: workoutPrograms.id,
        isPersonal: workoutPrograms.isPersonal,
      })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (!program) throw new NotFoundException('Workout program not found');
    if (program.isPersonal)
      throw new ForbiddenException(
        'Only official programs can have managed images',
      );
    const replacedKey = await this.setImageKey(programId, null);
    await this.storageService.remove(replacedKey);
    return this.getProgramById(programId, 0, 'moderator');
  }

  private async setImageKey(
    programId: number,
    imageKey: string | null,
  ): Promise<string | null> {
    return db.transaction(async (tx: DbTransaction) => {
      const [current] = await tx
        .select({
          imageKey: workoutPrograms.imageKey,
          isPersonal: workoutPrograms.isPersonal,
          createdById: workoutPrograms.createdById,
        })
        .from(workoutPrograms)
        .where(eq(workoutPrograms.id, programId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('Workout program not found');
      if (current.isPersonal)
        throw new ForbiddenException(
          'Only official programs can have managed images',
        );
      await tx
        .update(workoutPrograms)
        .set({ imageKey, videoUrl: imageKey ? null : undefined })
        .where(eq(workoutPrograms.id, programId));
      await this.enqueueSearchChange(
        tx,
        { id: programId, createdById: current.createdById },
        'upsert',
      );
      return current.imageKey === imageKey ? null : current.imageKey;
    });
  }

  async getAllPrograms(userId: number, role: UserRole) {
    const visibility = hasMinimumRole(role, 'moderator')
      ? eq(workoutPrograms.isActive, true)
      : or(
          and(
            eq(workoutPrograms.isPersonal, false),
            eq(workoutPrograms.isActive, true),
          ),
          and(
            eq(workoutPrograms.isPersonal, true),
            eq(workoutPrograms.createdById, userId),
          ),
        );

    const programs = await db
      .select({
        id: workoutPrograms.id,
        catalogKey: workoutPrograms.catalogKey,
        name: workoutPrograms.name,
        description: workoutPrograms.description,
        videoUrl: workoutPrograms.videoUrl,
        imageKey: workoutPrograms.imageKey,
        isPersonal: workoutPrograms.isPersonal,
        createdAt: workoutPrograms.createdAt,
        ownerUsername: users.username,
        createdById: workoutPrograms.createdById,
        likesCount: sql<number>`(select count(*)::int from program_likes where program_id = ${workoutPrograms.id})`,
        isLiked: sql<boolean>`exists(select 1 from program_likes where program_id = ${workoutPrograms.id} and user_id = ${userId})`,
        isScheduled: sql<boolean>`exists(select 1 from ${userProgramSchedule} where ${userProgramSchedule.userId} = ${userId} and ${userProgramSchedule.programId} = ${workoutPrograms.id}) or exists(select 1 from ${userProgramScheduleSeries} where ${userProgramScheduleSeries.userId} = ${userId} and ${userProgramScheduleSeries.programId} = ${workoutPrograms.id})`,
      })
      .from(workoutPrograms)
      .leftJoin(users, eq(workoutPrograms.createdById, users.id))
      .where(visibility)
      .orderBy(asc(workoutPrograms.isPersonal), asc(workoutPrograms.name));

    if (!programs.length) return [];
    const rows = await db
      .select({
        programId: programContent.programId,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
        setsCount: exerciseInPrograms.sets,
        targetReps: exerciseInPrograms.firstSetRepCount,
        targetDurationSeconds: exerciseInPrograms.targetDurationSeconds,
        position: exerciseInPrograms.position,
        plannedWeight: exerciseInPrograms.weight,
        exercise: {
          id: exercises.id,
          name: exercises.name,
          measurementType: exercises.measurementType,
          recommendedDurationSeconds: exercises.recommendedDurationSeconds,
        },
      })
      .from(programContent)
      .innerJoin(
        exerciseInPrograms,
        eq(exerciseInPrograms.programContentId, programContent.id),
      )
      .innerJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
      .where(
        inArray(
          programContent.programId,
          programs.map((program) => program.id),
        ),
      )
      .orderBy(
        asc(programContent.week),
        asc(exerciseInPrograms.weekDay),
        asc(exerciseInPrograms.position),
      );
    const schedules = new Map<number, typeof rows>();
    const exerciseTranslationsById = await this.exerciseTranslationsById(
      rows.map((row) => row.exercise.id),
    );
    for (const row of rows) {
      row.exercise = {
        ...row.exercise,
        translations: exerciseTranslationsById.get(row.exercise.id) ?? [],
      } as typeof row.exercise;
      if (!schedules.has(row.programId)) schedules.set(row.programId, []);
      schedules.get(row.programId)!.push(row);
    }
    const projected = await this.withProgramTranslations(
      await this.withImageUrls(programs),
    );
    return projected.map((program) => ({
      ...program,
      schedule: schedules.get(program.id) || [],
    }));
  }

  async toggleLike(userId: number, role: UserRole, programId: number) {
    const program = await this.getProgramById(programId, userId, role);
    return db.transaction(async (tx: DbTransaction) => {
      const condition = and(
        eq(programLikes.userId, userId),
        eq(programLikes.programId, programId),
      );
      const removed = await tx
        .delete(programLikes)
        .where(condition)
        .returning();
      if (!removed.length)
        await tx
          .insert(programLikes)
          .values({ userId, programId })
          .onConflictDoNothing();
      await this.enqueueSearchChange(tx, program, 'upsert');
      return { isLiked: !removed.length };
    });
  }

  async getProgramById(id: number, userId: number, role: UserRole) {
    const [program] = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, id))
      .limit(1);
    if (!program) throw new NotFoundException('Workout program not found');

    if (
      program.isPersonal &&
      program.createdById !== userId &&
      !hasMinimumRole(role, 'moderator')
    ) {
      throw new ForbiddenException('This personal program is private');
    }
    if (
      !program.isPersonal &&
      !program.isActive &&
      !hasMinimumRole(role, 'moderator')
    ) {
      const [assignment] = await db
        .select({ id: userProgramSchedule.id })
        .from(userProgramSchedule)
        .where(
          and(
            eq(userProgramSchedule.userId, userId),
            eq(userProgramSchedule.programId, id),
          ),
        )
        .limit(1);
      if (!assignment) throw new NotFoundException('Workout program not found');
    }

    const { shareToken, sourceProgramId, ...safeProgram } = program;
    void shareToken;
    void sourceProgramId;
    const [localizedProgram] = await this.withProgramTranslations([
      await this.withImageUrl(safeProgram),
    ]);
    return {
      ...localizedProgram,
      schedule: await this.getSchedule(id),
    };
  }

  private async createProgram(
    userId: number,
    isPersonal: boolean,
    dto: CreateWorkoutProgramDto,
    sourceProgramId: number | null = null,
  ) {
    this.validateDefinitions(dto.exercises);
    return db.transaction(async (tx: DbTransaction) => {
      await this.ensureExercisesExist(tx, dto.exercises);
      const [program] = await tx
        .insert(workoutPrograms)
        .values({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          videoUrl: dto.videoUrl?.trim() || null,
          isPersonal,
          createdById: userId,
          sourceProgramId,
          ...(isPersonal ? {} : { catalogKey: dto.catalogKey?.trim() || null }),
        })
        .returning();
      if (!isPersonal) {
        const translations = dto.translations?.length
          ? dto.translations
          : [
              {
                locale: 'en',
                name: program.name,
                description: program.description ?? undefined,
                videoUrl: program.videoUrl ?? undefined,
              },
            ];
        this.validateTranslations(translations);
        await tx.insert(workoutProgramTranslations).values(
          translations.map((translation) => ({
            workoutProgramId: program.id,
            locale: translation.locale,
            name: translation.name.trim(),
            description: translation.description?.trim() || null,
            videoUrl: translation.videoUrl?.trim() || null,
            aliases: (translation.aliases ?? []).map((alias) => alias.trim()),
          })),
        );
      }
      await this.replaceSchedule(tx, program.id, dto.exercises);
      await this.enqueueSearchChange(tx, program, 'upsert');
      return this.withImageUrl(program);
    });
  }

  private async updatePersonalProgram(
    id: number,
    dto: UpdateWorkoutProgramDto,
  ) {
    const result = await db.transaction(async (tx: DbTransaction) => {
      const [current] = await tx
        .select({ imageKey: workoutPrograms.imageKey })
        .from(workoutPrograms)
        .where(eq(workoutPrograms.id, id))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('Workout program not found');
      const [program] = await tx
        .update(workoutPrograms)
        .set({
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
          ...(dto.videoUrl !== undefined
            ? { videoUrl: dto.videoUrl.trim() || null, imageKey: null }
            : {}),
        })
        .where(eq(workoutPrograms.id, id))
        .returning();

      if (dto.exercises !== undefined) {
        await this.ensureExercisesExist(tx, dto.exercises);
        await this.replaceSchedule(tx, id, dto.exercises);
      }
      await this.enqueueSearchChange(tx, program, 'upsert');
      return {
        program,
        replacedKey: dto.videoUrl !== undefined ? current.imageKey : null,
      };
    });
    await this.storageService.remove(result.replacedKey);
    return this.withImageUrl(result.program);
  }

  private async createOfficialRevision(
    userId: number,
    loaded: typeof workoutPrograms.$inferSelect,
    dto: UpdateWorkoutProgramDto,
  ) {
    if (dto.exercises) this.validateDefinitions(dto.exercises);
    const result = await db.transaction(async (tx: DbTransaction) => {
      // Two moderators editing the same revision would otherwise both fork it
      // and leave two active copies. The lock serializes them; the second one
      // sees the revision already retired and gets a conflict to reload.
      const [program] = await tx
        .select()
        .from(workoutPrograms)
        .where(eq(workoutPrograms.id, loaded.id))
        .for('update')
        .limit(1);
      if (!program) throw new NotFoundException('Workout program not found');
      if (loaded.isActive && !program.isActive) {
        throw new ConflictException({
          message:
            'This program was changed by another moderator. Reload it and try again.',
          code: 'PROGRAM_REVISION_CONFLICT',
        });
      }
      const definitions =
        dto.exercises ?? (await this.getScheduleExercises(tx, program.id));
      await this.ensureExercisesExist(tx, definitions);
      const [revision] = await tx
        .insert(workoutPrograms)
        .values({
          name: dto.name?.trim() ?? program.name,
          description:
            dto.description !== undefined
              ? dto.description.trim() || null
              : program.description,
          videoUrl:
            dto.videoUrl !== undefined
              ? dto.videoUrl.trim() || null
              : program.videoUrl,
          imageKey: dto.videoUrl !== undefined ? null : program.imageKey,
          isPersonal: false,
          createdById: userId,
          catalogKey: program.catalogKey,
        })
        .returning();
      const storedTranslations: Array<{
        locale: string;
        name: string;
        description?: string | null;
        videoUrl?: string | null;
        aliases?: string[];
      }> = await tx
        .select()
        .from(workoutProgramTranslations)
        .where(eq(workoutProgramTranslations.workoutProgramId, program.id));
      const translations =
        dto.translations ??
        (storedTranslations.length
          ? storedTranslations.map((translation) =>
              translation.locale === 'en'
                ? {
                    ...translation,
                    name: dto.name?.trim() ?? revision.name,
                    description:
                      dto.description !== undefined
                        ? dto.description.trim() || null
                        : revision.description,
                    videoUrl:
                      dto.videoUrl !== undefined
                        ? dto.videoUrl.trim() || null
                        : revision.videoUrl,
                  }
                : translation,
            )
          : [
              {
                locale: 'en',
                name: revision.name,
                description: revision.description,
                videoUrl: revision.videoUrl,
                aliases: [],
              },
            ]);
      this.validateTranslations(translations);
      await tx.insert(workoutProgramTranslations).values(
        translations.map((translation) => ({
          workoutProgramId: revision.id,
          locale: translation.locale,
          name: translation.name.trim(),
          description: translation.description?.trim() || null,
          videoUrl: translation.videoUrl?.trim() || null,
          aliases: (translation.aliases ?? []).map((alias) => alias.trim()),
        })),
      );
      await this.replaceSchedule(tx, revision.id, definitions);
      const movedImageKey =
        dto.videoUrl === undefined ? program.imageKey : null;
      const replacedKey = dto.videoUrl !== undefined ? program.imageKey : null;
      if (movedImageKey || replacedKey) {
        await tx
          .update(workoutPrograms)
          .set({ imageKey: null })
          .where(eq(workoutPrograms.id, program.id));
      }
      await tx
        .update(workoutPrograms)
        .set({ isActive: false })
        .where(eq(workoutPrograms.id, program.id));
      await this.enqueueSearchChange(tx, program, 'retire');
      await this.enqueueSearchChange(tx, revision, 'upsert');
      return { revision, replacedKey };
    });
    await this.storageService.remove(result.replacedKey);
    return this.withImageUrl(result.revision);
  }

  private async ensureExercisesExist(
    tx: DbTransaction,
    definitions: ProgramExerciseDto[],
  ) {
    const ids = [...new Set(definitions.map((item) => item.exerciseId))];
    const found = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(or(...ids.map((id) => eq(exercises.id, id))));
    if (found.length !== ids.length)
      throw new BadRequestException('One or more exercises do not exist');
  }

  private validateDefinitions(definitions: ProgramExerciseDto[]) {
    const positions = new Set<string>();
    for (const item of definitions) {
      const key = `${item.week ?? 1}:${item.weekDay}:${item.position}`;
      if (item.position !== undefined && positions.has(key))
        throw new BadRequestException(
          'Duplicate exercise position in week/day.',
        );
      if (item.position !== undefined) positions.add(key);
    }
  }

  private validateTranslations(
    translations: Array<{
      locale: string;
      name?: string;
      aliases?: string[];
    }>,
  ) {
    if (
      new Set(translations.map((translation) => translation.locale)).size !==
      translations.length
    )
      throw new BadRequestException('Translation locales must be unique.');
    if (
      translations.some(
        (translation) =>
          !translation.name?.trim() ||
          (translation.aliases ?? []).some((alias) => !alias.trim()),
      )
    )
      throw new BadRequestException(
        'Translation names and aliases must be non-blank.',
      );
  }

  private enqueueSearchChange(
    tx: DbTransaction,
    program: { id: number; createdById: number | null },
    change: 'upsert' | 'retire' | 'delete',
  ) {
    return this.outbox.enqueue(tx, {
      type: 'catalog.program.changed',
      aggregateId: program.id,
      payload: {
        programId: program.id,
        ownerId: program.createdById,
        change,
      },
    });
  }

  private async replaceSchedule(
    tx: DbTransaction,
    programId: number,
    definitions: ProgramExerciseDto[],
  ) {
    const exerciseIds = [
      ...new Set(definitions.map((item) => item.exerciseId)),
    ];
    const exerciseRows = await tx
      .select({ id: exercises.id, measurementType: exercises.measurementType })
      .from(exercises)
      .where(inArray(exercises.id, exerciseIds));
    const measurementTypes = new Map(
      exerciseRows.map((exercise) => [exercise.id, exercise.measurementType]),
    );
    for (const item of definitions) {
      const measurementType = measurementTypes.get(item.exerciseId);
      if (!measurementType) throw new BadRequestException('Exercise not found');
      if (item.reps !== undefined && item.durationSeconds !== undefined) {
        throw new BadRequestException(
          'Program exercise cannot target both reps and duration',
        );
      }
      if (item.reps !== undefined && measurementType !== 'reps') {
        throw new BadRequestException(
          'Duration exercise requires durationSeconds',
        );
      }
      if (
        item.durationSeconds !== undefined &&
        measurementType !== 'duration'
      ) {
        throw new BadRequestException('Repetition exercise requires reps');
      }
    }
    await tx
      .delete(programContent)
      .where(eq(programContent.programId, programId));
    const contentByWeek = new Map<number, number>();
    for (const week of [
      ...new Set(definitions.map((item) => item.week ?? 1)),
    ]) {
      const [content] = await tx
        .insert(programContent)
        .values({ programId, week })
        .returning();
      contentByWeek.set(week, content.id);
    }
    const usedPositions = new Map<string, Set<number>>();
    for (const item of definitions) {
      if (item.position === undefined) continue;
      const key = `${item.week ?? 1}:${item.weekDay}`;
      const used = usedPositions.get(key) ?? new Set<number>();
      used.add(item.position);
      usedPositions.set(key, used);
    }
    await tx.insert(exerciseInPrograms).values(
      definitions.map((item) => {
        const key = `${item.week ?? 1}:${item.weekDay}`;
        const used = usedPositions.get(key) ?? new Set<number>();
        let next = 1;
        while (used.has(next)) next += 1;
        const position = item.position ?? next;
        used.add(position);
        usedPositions.set(key, used);
        return {
          programContentId: contentByWeek.get(item.week ?? 1)!,
          exerciseId: item.exerciseId,
          sets: item.sets ?? null,
          position,
          firstSetRepCount: item.reps ?? null,
          targetDurationSeconds: item.durationSeconds ?? null,
          weight: item.weight ?? null,
          weekDay: item.weekDay,
        };
      }),
    );
  }

  private async getScheduleExercises(
    tx: DbTransaction | typeof db,
    programId: number,
  ): Promise<ProgramExerciseDto[]> {
    return tx
      .select({
        exerciseId: exerciseInPrograms.exerciseId,
        sets: sql<number | undefined>`${exerciseInPrograms.sets}`,
        reps: sql<number | undefined>`${exerciseInPrograms.firstSetRepCount}`,
        durationSeconds: sql<
          number | undefined
        >`${exerciseInPrograms.targetDurationSeconds}`,
        weight: sql<number | undefined>`${exerciseInPrograms.weight}`,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
        position: exerciseInPrograms.position,
      })
      .from(exerciseInPrograms)
      .innerJoin(
        programContent,
        eq(programContent.id, exerciseInPrograms.programContentId),
      )
      .where(eq(programContent.programId, programId))
      .orderBy(
        asc(programContent.week),
        asc(exerciseInPrograms.weekDay),
        asc(exerciseInPrograms.position),
      );
  }

  private async getSchedule(programId: number) {
    const rows = await db
      .select({
        contentId: programContent.id,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
        setsCount: exerciseInPrograms.sets,
        targetReps: exerciseInPrograms.firstSetRepCount,
        targetDurationSeconds: exerciseInPrograms.targetDurationSeconds,
        position: exerciseInPrograms.position,
        plannedWeight: exerciseInPrograms.weight,
        exercise: {
          id: exercises.id,
          catalogKey: exercises.catalogKey,
          name: exercises.name,
          description: exercises.description,
          videoUrl: exercises.videoUrl,
          difficulty: exercises.difficulty,
          measurementType: exercises.measurementType,
          recommendedDurationSeconds: exercises.recommendedDurationSeconds,
          recommendedSets: exercises.recommendedSets,
          recommendedReps: exercises.recommendedReps,
          equipment: exercises.equipment,
          equipmentStructured: exercises.equipmentStructured,
          imageKey: exercises.imageKey,
          demonstrationImageKey: exercises.demonstrationImageKey,
        },
      })
      .from(programContent)
      .leftJoin(
        exerciseInPrograms,
        eq(programContent.id, exerciseInPrograms.programContentId),
      )
      .leftJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
      .where(eq(programContent.programId, programId))
      .orderBy(
        asc(programContent.week),
        asc(exerciseInPrograms.weekDay),
        asc(exerciseInPrograms.position),
      );
    const imageUrls = await this.storageService.getUrls(
      rows.map((row) => row.exercise?.imageKey),
    );
    const demonstrationImageUrls = await this.storageService.getUrls(
      rows.map((row) => row.exercise?.demonstrationImageKey),
    );
    const translationsById = await this.exerciseTranslationsById(
      rows.flatMap((row) => (row.exercise?.id ? [row.exercise.id] : [])),
    );
    return rows.map((row, index) => {
      const exercise = row.exercise ? { ...row.exercise } : undefined;
      if (exercise) {
        const { imageKey, demonstrationImageKey, ...safeExercise } = exercise;
        void imageKey;
        void demonstrationImageKey;
        return {
          ...row,
          exercise: {
            ...safeExercise,
            imageUrl: imageUrls[index],
            demonstrationImageUrl: demonstrationImageUrls[index],
            translations: translationsById.get(exercise.id) ?? [],
          },
        };
      }
      return {
        ...row,
        exercise: row.exercise,
      };
    });
  }

  private async findSharedProgram(token: string) {
    const [program] = await db
      .select({
        id: workoutPrograms.id,
        name: workoutPrograms.name,
        description: workoutPrograms.description,
        videoUrl: workoutPrograms.videoUrl,
        imageKey: workoutPrograms.imageKey,
        isPersonal: workoutPrograms.isPersonal,
        createdAt: workoutPrograms.createdAt,
        createdById: workoutPrograms.createdById,
        ownerUsername: users.username,
      })
      .from(workoutPrograms)
      .leftJoin(users, eq(workoutPrograms.createdById, users.id))
      .where(eq(workoutPrograms.shareToken, token))
      .limit(1);
    if (!program)
      throw new NotFoundException('Shared workout program not found');
    return program;
  }

  private async withImageUrl<T extends { imageKey?: string | null }>(
    row: T,
  ): Promise<Omit<T, 'imageKey'> & { imageUrl: string | null }> {
    const { imageKey, ...rest } = row;
    return { ...rest, imageUrl: await this.storageService.getUrl(imageKey) };
  }

  private async withImageUrls<T extends { imageKey?: string | null }>(
    rows: T[],
  ) {
    return Promise.all(rows.map((row) => this.withImageUrl(row)));
  }

  private async withProgramTranslations<
    T extends {
      id: number;
      isPersonal: boolean;
      name: string;
      description: string | null;
    },
  >(rows: T[]) {
    if (!rows.length) return [];
    const officialIds = rows
      .filter((row) => !row.isPersonal)
      .map((row) => row.id);
    if (!officialIds.length)
      return rows.map((row) => ({ ...row, translations: [] }));
    const translations = await db
      .select({
        workoutProgramId: workoutProgramTranslations.workoutProgramId,
        locale: workoutProgramTranslations.locale,
        name: workoutProgramTranslations.name,
        description: workoutProgramTranslations.description,
        videoUrl: workoutProgramTranslations.videoUrl,
        aliases: workoutProgramTranslations.aliases,
      })
      .from(workoutProgramTranslations)
      .where(inArray(workoutProgramTranslations.workoutProgramId, officialIds));
    const byProgram = new Map<number, typeof translations>();
    for (const translation of translations) {
      const group = byProgram.get(translation.workoutProgramId) ?? [];
      group.push(translation);
      byProgram.set(translation.workoutProgramId, group);
    }
    return rows.map((row) => ({
      ...row,
      translations: row.isPersonal ? [] : (byProgram.get(row.id) ?? []),
    }));
  }

  private async exerciseTranslationsById(exerciseIds: number[]) {
    const ids = [...new Set(exerciseIds)];
    if (!ids.length) return new Map<number, never[]>();
    const translations = await db
      .select({
        exerciseId: exerciseTranslations.exerciseId,
        locale: exerciseTranslations.locale,
        name: exerciseTranslations.name,
        description: exerciseTranslations.description,
        videoUrl: exerciseTranslations.videoUrl,
        aliases: exerciseTranslations.aliases,
      })
      .from(exerciseTranslations)
      .where(inArray(exerciseTranslations.exerciseId, ids));
    const byExercise = new Map<number, typeof translations>();
    for (const translation of translations) {
      const group = byExercise.get(translation.exerciseId) ?? [];
      group.push(translation);
      byExercise.set(translation.exerciseId, group);
    }
    return byExercise;
  }

  private async findMatchingPersonalProgram(
    userId: number,
    sourceExercises: readonly Pick<ProgramExerciseDto, 'exerciseId'>[],
  ) {
    const program = await this.findMatchingProgram(
      userId,
      sourceExercises,
      false,
    );
    return program?.id ?? null;
  }

  private async findMatchingProgram(
    userId: number,
    sourceExercises: readonly Pick<ProgramExerciseDto, 'exerciseId'>[],
    includeOfficial: boolean,
  ) {
    const candidates = await db
      .select({
        id: workoutPrograms.id,
        name: workoutPrograms.name,
        isPersonal: workoutPrograms.isPersonal,
      })
      .from(workoutPrograms)
      .where(
        includeOfficial
          ? or(
              and(
                eq(workoutPrograms.isPersonal, true),
                eq(workoutPrograms.createdById, userId),
              ),
              and(
                eq(workoutPrograms.isPersonal, false),
                eq(workoutPrograms.isActive, true),
              ),
            )
          : and(
              eq(workoutPrograms.isPersonal, true),
              eq(workoutPrograms.createdById, userId),
            ),
      );
    if (!candidates.length) return null;

    const rows = await db
      .select({
        programId: programContent.programId,
        exerciseId: exerciseInPrograms.exerciseId,
      })
      .from(programContent)
      .innerJoin(
        exerciseInPrograms,
        eq(exerciseInPrograms.programContentId, programContent.id),
      )
      .where(
        inArray(
          programContent.programId,
          candidates.map((candidate) => candidate.id),
        ),
      );

    return (
      candidates.find((candidate) =>
        hasSameExerciseMultiset(
          sourceExercises,
          rows.filter((row) => row.programId === candidate.id),
        ),
      ) ?? null
    );
  }
}
