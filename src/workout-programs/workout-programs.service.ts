import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
  exerciseInPrograms,
  exercises,
  programContent,
  users,
  userProgramSchedule,
  userProgramScheduleSeries,
  workoutPrograms,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { CreateWorkoutProgramDto, ProgramExerciseDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import { ListScheduleDto, ScheduleProgramDto } from './dto/schedule-program.dto';
import { scheduleStatus, weeklyDatesInRange } from './schedule.utils';

@Injectable()
export class WorkoutProgramsService {
  async createPersonalProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, true, dto);
  }

  async createOfficialProgram(userId: number, dto: CreateWorkoutProgramDto) {
    return this.createProgram(userId, false, dto);
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
      })
      .from(userProgramSchedule)
      .innerJoin(workoutPrograms, eq(userProgramSchedule.programId, workoutPrograms.id))
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

  async getAllPrograms(userId: number, role: UserRole) {
    const visibility = hasMinimumRole(role, 'moderator')
      ? eq(workoutPrograms.isActive, true)
      : or(
        and(eq(workoutPrograms.isPersonal, false), eq(workoutPrograms.isActive, true)),
        and(eq(workoutPrograms.isPersonal, true), eq(workoutPrograms.createdById, userId)),
      );

    return db
      .select({
        id: workoutPrograms.id,
        name: workoutPrograms.name,
        description: workoutPrograms.description,
        isPersonal: workoutPrograms.isPersonal,
        createdAt: workoutPrograms.createdAt,
        ownerUsername: users.username,
      })
      .from(workoutPrograms)
      .leftJoin(users, eq(workoutPrograms.createdById, users.id))
      .where(visibility)
      .orderBy(asc(workoutPrograms.isPersonal), asc(workoutPrograms.name));
  }

  async getProgramById(id: number, userId: number, role: UserRole) {
    const [program] = await db.select().from(workoutPrograms).where(eq(workoutPrograms.id, id)).limit(1);
    if (!program) throw new NotFoundException('Workout program not found');

    if (program.isPersonal && program.createdById !== userId && !hasMinimumRole(role, 'moderator')) {
      throw new ForbiddenException('This personal program is private');
    }
    if (!program.isPersonal && !program.isActive && !hasMinimumRole(role, 'moderator')) {
      throw new NotFoundException('Workout program not found');
    }

    return { ...program, schedule: await this.getSchedule(id) };
  }

  private async createProgram(userId: number, isPersonal: boolean, dto: CreateWorkoutProgramDto) {
    return db.transaction(async (tx: any) => {
      await this.ensureExercisesExist(tx, dto.exercises);
      const [program] = await tx
        .insert(workoutPrograms)
        .values({
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          isPersonal,
          createdById: userId,
        })
        .returning();
      await this.replaceSchedule(tx, program.id, dto.exercises);
      return program;
    });
  }

  private async updatePersonalProgram(id: number, dto: UpdateWorkoutProgramDto) {
    return db.transaction(async (tx: any) => {
      const [program] = await tx
        .update(workoutPrograms)
        .set({
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
        })
        .where(eq(workoutPrograms.id, id))
        .returning();

      if (dto.exercises !== undefined) {
        await this.ensureExercisesExist(tx, dto.exercises);
        await this.replaceSchedule(tx, id, dto.exercises);
      }
      return program;
    });
  }

  private async createOfficialRevision(userId: number, program: typeof workoutPrograms.$inferSelect, dto: UpdateWorkoutProgramDto) {
    return db.transaction(async (tx: any) => {
      const definitions = dto.exercises ?? await this.getScheduleExercises(tx, program.id);
      await this.ensureExercisesExist(tx, definitions);
      const [revision] = await tx
        .insert(workoutPrograms)
        .values({
          name: dto.name?.trim() ?? program.name,
          description: dto.description !== undefined ? dto.description.trim() || null : program.description,
          isPersonal: false,
          createdById: userId,
        })
        .returning();
      await this.replaceSchedule(tx, revision.id, definitions);
      await tx.update(workoutPrograms).set({ isActive: false }).where(eq(workoutPrograms.id, program.id));
      return revision;
    });
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
      .where(eq(programContent.programId, programId));
  }

  private async getSchedule(programId: number) {
    return db
      .select({
        contentId: programContent.id,
        week: programContent.week,
        weekDay: exerciseInPrograms.weekDay,
        setsCount: exerciseInPrograms.sets,
        targetReps: exerciseInPrograms.firstSetRepCount,
        plannedWeight: exerciseInPrograms.weight,
        exercise: { id: exercises.id, name: exercises.name },
      })
      .from(programContent)
      .leftJoin(exerciseInPrograms, eq(programContent.id, exerciseInPrograms.programContentId))
      .leftJoin(exercises, eq(exercises.id, exerciseInPrograms.exerciseId))
      .where(eq(programContent.programId, programId));
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
