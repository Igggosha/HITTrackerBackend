import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, or } from 'drizzle-orm';
import { db } from '../db/db';
import {
  exerciseInPrograms,
  exercises,
  programContent,
  users,
  userProgramSchedule,
  workoutPrograms,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { CreateWorkoutProgramDto, ProgramExerciseDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';
import { ScheduleProgramDto } from './dto/schedule-program.dto';

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
    const [assignment] = await db
      .insert(userProgramSchedule)
      .values({ userId, programId: dto.programId, scheduledFor: dto.scheduledFor })
      .onConflictDoUpdate({
        target: [userProgramSchedule.userId, userProgramSchedule.scheduledFor],
        set: { programId: dto.programId },
      })
      .returning();
    return assignment;
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
}
