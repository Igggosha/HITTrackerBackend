import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db';
import {
  exerciseInPrograms,
  exercises,
  programContent,
  users,
  userProgramSchedule,
  userProgramScheduleSeries,
  workouts,
  workoutPrograms,
  programLikes,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { CreateWorkoutProgramDto, ProgramExerciseDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import { ListScheduleDto, ScheduleProgramDto } from './dto/schedule-program.dto';
import { scheduleStatus, weeklyDatesInRange } from './schedule.utils';
import { hasSameExerciseMultiset } from './sharing.utils';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';

@Injectable()
export class WorkoutProgramsService {
  constructor(private readonly storageService: StorageService) {}

  async createPersonalProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, true, dto);
  }

  async createOfficialProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, false, dto);
  }

  async findMatchingProgramByExerciseIds(userId: number, exerciseIds: number[]) {
    const programId = await this.findMatchingProgram(
      userId,
      exerciseIds.map((exerciseId) => ({ exerciseId })),
      true,
    );
    return { programId };
  }

  async copyAsPersonalProgram(userId: number, role: UserRole, sourceId: number, dto: CreateWorkoutProgramDto) {
    const [source] = await db.select().from(workoutPrograms).where(eq(workoutPrograms.id, sourceId)).limit(1);
    if (!source) throw new NotFoundException('Workout program not found');
    if (source.isPersonal && source.createdById !== userId) {
      throw new ForbiddenException('Personal programs cannot be copied');
    }
    if (!source.isPersonal && !source.isActive && !hasMinimumRole(role, 'moderator')) {
      throw new NotFoundException('Workout program not found');
    }
    return this.createPersonalProgram(userId, dto);
  }

  async createShareToken(userId: number, role: UserRole, programId: number) {
    const accessible = await this.getProgramById(programId, userId, role);
    if (accessible.isPersonal && accessible.createdById !== userId) {
      throw new ForbiddenException('Only the owner can share a personal program');
    }

    const [program] = await db.select({ shareToken: workoutPrograms.shareToken })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (program.shareToken) return { token: program.shareToken };

    const token = randomUUID();
    const [updated] = await db.update(workoutPrograms)
      .set({ shareToken: token })
      .where(and(eq(workoutPrograms.id, programId), isNull(workoutPrograms.shareToken)))
      .returning({ shareToken: workoutPrograms.shareToken });
    if (updated?.shareToken) return { token: updated.shareToken };

    const [current] = await db.select({ shareToken: workoutPrograms.shareToken })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId))
      .limit(1);
    if (!current?.shareToken) throw new NotFoundException('Workout program not found');
    return { token: current.shareToken };
  }

  async getSharedProgram(token: string) {
    const source = await this.findSharedProgram(token);
    const { createdById: _createdById, ...program } = source;
    return { ...(await this.withImageUrl(program)), schedule: await this.getSchedule(source.id) };
  }

  async importSharedProgram(userId: number, token: string) {
    const source = await this.findSharedProgram(token);
    if (!source.isPersonal || source.createdById === userId) {
      return { programId: source.id, imported: false, alreadyImported: true };
    }

    const findExisting = async () => {
      const [existing] = await db.select({ id: workoutPrograms.id })
        .from(workoutPrograms)
        .where(and(
          eq(workoutPrograms.createdById, userId),
          eq(workoutPrograms.sourceProgramId, source.id),
        ))
        .limit(1);
      return existing;
    };
    const existing = await findExisting();
    if (existing) return { programId: existing.id, imported: false, alreadyImported: true };

    try {
      const exercises = await this.getScheduleExercises(db, source.id);
      const matchingProgramId = await this.findMatchingPersonalProgram(userId, exercises);
      if (matchingProgramId) {
        return { programId: matchingProgramId, imported: false, alreadyImported: true };
      }
      const program = await this.createProgram(userId, true, {
        name: source.name,
        description: source.description ?? undefined,
        exercises,
      }, source.id);
      return { programId: program.id, imported: true, alreadyImported: false };
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const raced = await findExisting();
      if (!raced) throw error;
      return { programId: raced.id, imported: false, alreadyImported: true };
    }
  }

  async scheduleProgram(userId: number, role: UserRole, dto: ScheduleProgramDto) {
    await this.getProgramById(dto.programId, userId, role);
    if (dto.repeat !== 'weekly') {
      return db.insert(userProgramSchedule)
        .values({ userId, programId: dto.programId, scheduledFor: dto.scheduledFor })
        .onConflictDoNothing()
        .returning();
    }

    return db.transaction(async (tx: any) => {
      const [series] = await tx.insert(userProgramScheduleSeries).values({
        userId,
        programId: dto.programId,
        startsOn: dto.scheduledFor,
        endsOn: dto.repeatUntil ?? null,
      }).returning();
      return tx.insert(userProgramSchedule).values({
        userId,
        programId: dto.programId,
        scheduledFor: dto.scheduledFor,
        seriesId: series.id,
      }).onConflictDoNothing().returning();
    });
  }

  async getCalendar(userId: number, { from, to }: ListScheduleDto) {
    await this.materializeWeeklyAssignments(userId, from, to);
    const today = new Date().toISOString().slice(0, 10);
    const assignments = await db
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
      .innerJoin(workoutPrograms, eq(userProgramSchedule.programId, workoutPrograms.id))
      .leftJoin(workouts, and(eq(workouts.scheduleId, userProgramSchedule.id), eq(workouts.status, 'completed')))
      .where(and(
        eq(userProgramSchedule.userId, userId),
        gte(userProgramSchedule.scheduledFor, from),
        lte(userProgramSchedule.scheduledFor, to),
      ))
      .orderBy(asc(userProgramSchedule.scheduledFor), asc(userProgramSchedule.id));

    return assignments.map(({ storedStatus, ...assignment }) => ({
      ...assignment,
      status: scheduleStatus(storedStatus, assignment.scheduledFor, today),
    }));
  }

  async removeScheduledProgram(userId: number, id: number) {
    const [assignment] = await db.select({ seriesId: userProgramSchedule.seriesId })
      .from(userProgramSchedule)
      .where(and(eq(userProgramSchedule.id, id), eq(userProgramSchedule.userId, userId)))
      .limit(1);
    if (!assignment) throw new NotFoundException('Scheduled workout not found');

    if (assignment.seriesId) {
      await db.delete(userProgramScheduleSeries).where(eq(userProgramScheduleSeries.id, assignment.seriesId));
    } else {
      await db.delete(userProgramSchedule).where(eq(userProgramSchedule.id, id));
    }
  }

  async updateProgram(userId: number, role: UserRole, id: number, dto: UpdateWorkoutProgramDto) {
    const [program] = await db.select().from(workoutPrograms).where(eq(workoutPrograms.id, id)).limit(1);
    if (!program) throw new NotFoundException('Workout program not found');

    if (program.isPersonal) {
      if (program.createdById !== userId) {
        throw new ForbiddenException('Personal programs can only be edited by their owner');
      }
      return this.updatePersonalProgram(id, dto);
    }

    if (!hasMinimumRole(role, 'moderator')) {
      throw new ForbiddenException('Only moderators can edit official programs');
    }
    return this.createOfficialRevision(userId, program, dto);
  }

  async setImage(programId: number, file: UploadedFile | undefined) {
    const [program] = await db.select().from(workoutPrograms)
      .where(eq(workoutPrograms.id, programId)).limit(1);
    if (!program) throw new NotFoundException('Workout program not found');
    if (program.isPersonal) throw new ForbiddenException('Only official programs can have managed images');

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
    const [program] = await db.select({ id: workoutPrograms.id, isPersonal: workoutPrograms.isPersonal })
      .from(workoutPrograms).where(eq(workoutPrograms.id, programId)).limit(1);
    if (!program) throw new NotFoundException('Workout program not found');
    if (program.isPersonal) throw new ForbiddenException('Only official programs can have managed images');
    const replacedKey = await this.setImageKey(programId, null);
    await this.storageService.remove(replacedKey);
    return this.getProgramById(programId, 0, 'moderator');
  }

  private async setImageKey(programId: number, imageKey: string | null): Promise<string | null> {
    return db.transaction(async (tx: any) => {
      const [current] = await tx.select({ imageKey: workoutPrograms.imageKey, isPersonal: workoutPrograms.isPersonal })
        .from(workoutPrograms).where(eq(workoutPrograms.id, programId)).for('update').limit(1);
      if (!current) throw new NotFoundException('Workout program not found');
      if (current.isPersonal) throw new ForbiddenException('Only official programs can have managed images');
      await tx.update(workoutPrograms).set({ imageKey, videoUrl: imageKey ? null : undefined }).where(eq(workoutPrograms.id, programId));
      return current.imageKey === imageKey ? null : current.imageKey;
    });
  }

  async getAllPrograms(userId: number, role: UserRole) {
    const visibility = hasMinimumRole(role, 'moderator')
      ? eq(workoutPrograms.isActive, true)
      : or(
        and(eq(workoutPrograms.isPersonal, false), eq(workoutPrograms.isActive, true)),
        and(eq(workoutPrograms.isPersonal, true), eq(workoutPrograms.createdById, userId)),
      );

    const programs = await db
      .select({
        id: workoutPrograms.id,
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
    const rows = await db.select({
      programId: programContent.programId,
      week: programContent.week,
      weekDay: exerciseInPrograms.weekDay,
      setsCount: exerciseInPrograms.sets,
      targetReps: exerciseInPrograms.firstSetRepCount,
      plannedWeight: exerciseInPrograms.weight,
      exercise: { id: exercises.id, name: exercises.name },
    }).from(programContent)
      .innerJoin(exerciseInPrograms, eq(exerciseInPrograms.programContentId, programContent.id))
      .innerJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
      .where(inArray(programContent.programId, programs.map((program) => program.id)))
      .orderBy(asc(programContent.week), asc(exerciseInPrograms.weekDay), asc(exerciseInPrograms.id));
    const schedules = new Map<number, typeof rows>();
    for (const row of rows) {
      if (!schedules.has(row.programId)) schedules.set(row.programId, []);
      schedules.get(row.programId)!.push(row);
    }
    const projected = await this.withImageUrls(programs);
    return projected.map((program) => ({ ...program, schedule: schedules.get(program.id) || [] }));
  }

  async toggleLike(userId: number, role: UserRole, programId: number) {
    await this.getProgramById(programId, userId, role);
    const condition = and(eq(programLikes.userId, userId), eq(programLikes.programId, programId));
    const removed = await db.delete(programLikes).where(condition).returning();
    if (!removed.length) await db.insert(programLikes).values({ userId, programId }).onConflictDoNothing();
    return { isLiked: !removed.length };
  }

  async getProgramById(id: number, userId: number, role: UserRole) {
    const [program] = await db.select().from(workoutPrograms).where(eq(workoutPrograms.id, id)).limit(1);
    if (!program) throw new NotFoundException('Workout program not found');

    if (program.isPersonal && program.createdById !== userId && !hasMinimumRole(role, 'moderator')) {
      throw new ForbiddenException('This personal program is private');
    }
    if (!program.isPersonal && !program.isActive && !hasMinimumRole(role, 'moderator')) {
      const [assignment] = await db.select({ id: userProgramSchedule.id }).from(userProgramSchedule)
        .where(and(eq(userProgramSchedule.userId, userId), eq(userProgramSchedule.programId, id))).limit(1);
      if (!assignment) throw new NotFoundException('Workout program not found');
    }

    const { shareToken: _shareToken, sourceProgramId: _sourceProgramId, ...safeProgram } = program;
    return { ...(await this.withImageUrl(safeProgram)), schedule: await this.getSchedule(id) };
  }

  private async createProgram(
    userId: number,
    isPersonal: boolean,
    dto: CreateWorkoutProgramDto,
    sourceProgramId: number | null = null,
  ) {
    return db.transaction(async (tx: any) => {
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
        })
        .returning();
      await this.replaceSchedule(tx, program.id, dto.exercises);
      return this.withImageUrl(program);
    });
  }

  private async updatePersonalProgram(id: number, dto: UpdateWorkoutProgramDto) {
    const result = await db.transaction(async (tx: any) => {
      const [current] = await tx.select({ imageKey: workoutPrograms.imageKey })
        .from(workoutPrograms).where(eq(workoutPrograms.id, id)).for('update').limit(1);
      if (!current) throw new NotFoundException('Workout program not found');
      const [program] = await tx
        .update(workoutPrograms)
        .set({
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.videoUrl !== undefined ? { videoUrl: dto.videoUrl.trim() || null, imageKey: null } : {}),
        })
        .where(eq(workoutPrograms.id, id))
        .returning();

      if (dto.exercises !== undefined) {
        await this.ensureExercisesExist(tx, dto.exercises);
        await this.replaceSchedule(tx, id, dto.exercises);
      }
      return { program, replacedKey: dto.videoUrl !== undefined ? current.imageKey : null };
    });
    await this.storageService.remove(result.replacedKey);
    return this.withImageUrl(result.program);
  }

  private async createOfficialRevision(userId: number, program: typeof workoutPrograms.$inferSelect, dto: UpdateWorkoutProgramDto) {
    const result = await db.transaction(async (tx: any) => {
      const definitions = dto.exercises ?? await this.getScheduleExercises(tx, program.id);
      await this.ensureExercisesExist(tx, definitions);
      const [revision] = await tx
        .insert(workoutPrograms)
        .values({
          name: dto.name?.trim() ?? program.name,
          description: dto.description !== undefined ? dto.description.trim() || null : program.description,
          videoUrl: dto.videoUrl !== undefined ? dto.videoUrl.trim() || null : program.videoUrl,
          imageKey: dto.videoUrl !== undefined ? null : program.imageKey,
          isPersonal: false,
          createdById: userId,
        })
        .returning();
      await this.replaceSchedule(tx, revision.id, definitions);
      const movedImageKey = dto.videoUrl === undefined ? program.imageKey : null;
      const replacedKey = dto.videoUrl !== undefined ? program.imageKey : null;
      if (movedImageKey || replacedKey) {
        await tx.update(workoutPrograms).set({ imageKey: null }).where(eq(workoutPrograms.id, program.id));
      }
      await tx.update(workoutPrograms).set({ isActive: false }).where(eq(workoutPrograms.id, program.id));
      return { revision, replacedKey };
    });
    await this.storageService.remove(result.replacedKey);
    return this.withImageUrl(result.revision);
  }

  private async ensureExercisesExist(tx: any, definitions: ProgramExerciseDto[]) {
    const ids = [...new Set(definitions.map((item) => item.exerciseId))];
    const found = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(or(...ids.map((id) => eq(exercises.id, id))));
    if (found.length !== ids.length) throw new BadRequestException('One or more exercises do not exist');
  }

  private async replaceSchedule(tx: any, programId: number, definitions: ProgramExerciseDto[]) {
    await tx.delete(programContent).where(eq(programContent.programId, programId));
    const contentByWeek = new Map<number, number>();
    for (const week of [...new Set(definitions.map((item) => item.week ?? 1))]) {
      const [content] = await tx.insert(programContent).values({ programId, week }).returning();
      contentByWeek.set(week, content.id);
    }
    await tx.insert(exerciseInPrograms).values(definitions.map((item) => ({
      programContentId: contentByWeek.get(item.week ?? 1)!,
      exerciseId: item.exerciseId,
      sets: item.sets,
      firstSetRepCount: item.reps ?? null,
      weight: item.weight ?? null,
      weekDay: item.weekDay,
    })));
  }

  private async getScheduleExercises(tx: any, programId: number): Promise<ProgramExerciseDto[]> {
    return tx
      .select({
        exerciseId: exerciseInPrograms.exerciseId,
        sets: exerciseInPrograms.sets,
        reps: exerciseInPrograms.firstSetRepCount,
        weight: exerciseInPrograms.weight,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
      })
      .from(exerciseInPrograms)
      .innerJoin(programContent, eq(programContent.id, exerciseInPrograms.programContentId))
      .where(eq(programContent.programId, programId))
      .orderBy(asc(programContent.week), asc(exerciseInPrograms.weekDay), asc(exerciseInPrograms.id));
  }

  private async getSchedule(programId: number) {
    const rows = await db
      .select({
        contentId: programContent.id,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
        setsCount: exerciseInPrograms.sets,
        targetReps: exerciseInPrograms.firstSetRepCount,
        plannedWeight: exerciseInPrograms.weight,
        exercise: {
          id: exercises.id,
          name: exercises.name,
          difficulty: exercises.difficulty,
          imageKey: exercises.imageKey,
        },
      })
      .from(programContent)
      .leftJoin(exerciseInPrograms, eq(programContent.id, exerciseInPrograms.programContentId))
      .leftJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
      .where(eq(programContent.programId, programId))
      .orderBy(asc(programContent.week), asc(exerciseInPrograms.weekDay), asc(exerciseInPrograms.id));
    const imageUrls = await this.storageService.getUrls(rows.map((row: any) => row.exercise?.imageKey));
    return rows.map((row: any, index) => {
      const { imageKey: _imageKey, ...exercise } = row.exercise ?? {};
      return {
        ...row,
        exercise: row.exercise ? { ...exercise, imageUrl: imageUrls[index] } : row.exercise,
      };
    });
  }

  private async findSharedProgram(token: string) {
    const [program] = await db.select({
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
    if (!program) throw new NotFoundException('Shared workout program not found');
    return program;
  }

  private async withImageUrl<T extends { imageKey?: string | null }>(row: T): Promise<Omit<T, 'imageKey'> & { imageUrl: string | null }> {
    const { imageKey, ...rest } = row;
    return { ...rest, imageUrl: await this.storageService.getUrl(imageKey) };
  }

  private async withImageUrls<T extends { imageKey?: string | null }>(rows: T[]) {
    return Promise.all(rows.map((row) => this.withImageUrl(row)));
  }

  private async findMatchingPersonalProgram(
    userId: number,
    sourceExercises: readonly Pick<ProgramExerciseDto, 'exerciseId'>[],
  ) {
    return this.findMatchingProgram(userId, sourceExercises, false);
  }

  private async findMatchingProgram(
    userId: number,
    sourceExercises: readonly Pick<ProgramExerciseDto, 'exerciseId'>[],
    includeOfficial: boolean,
  ) {
    const candidates = await db
      .select({ id: workoutPrograms.id })
      .from(workoutPrograms)
      .where(includeOfficial
        ? or(
          and(eq(workoutPrograms.isPersonal, true), eq(workoutPrograms.createdById, userId)),
          eq(workoutPrograms.isPersonal, false),
        )
        : and(eq(workoutPrograms.isPersonal, true), eq(workoutPrograms.createdById, userId)));
    if (!candidates.length) return null;

    const rows = await db
      .select({ programId: programContent.programId, exerciseId: exerciseInPrograms.exerciseId })
      .from(programContent)
      .innerJoin(exerciseInPrograms, eq(exerciseInPrograms.programContentId, programContent.id))
      .where(inArray(programContent.programId, candidates.map((candidate) => candidate.id)));

    return candidates.find((candidate) => hasSameExerciseMultiset(
      sourceExercises,
      rows.filter((row) => row.programId === candidate.id),
    ))?.id ?? null;
  }

  private async materializeWeeklyAssignments(userId: number, from: string, to: string) {
    const series = await db.select().from(userProgramScheduleSeries).where(and(
      eq(userProgramScheduleSeries.userId, userId),
      lte(userProgramScheduleSeries.startsOn, to),
      or(isNull(userProgramScheduleSeries.endsOn), gte(userProgramScheduleSeries.endsOn, from)),
    ));
    const assignments = series.flatMap((item) => weeklyDatesInRange(
      item.startsOn,
      from,
      item.endsOn && item.endsOn < to ? item.endsOn : to,
    ).map((scheduledFor) => ({
      userId,
      programId: item.programId,
      scheduledFor,
      seriesId: item.id,
    })));
    if (assignments.length) await db.insert(userProgramSchedule).values(assignments).onConflictDoNothing();
  }
}
