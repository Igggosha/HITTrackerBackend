import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { workoutPrograms, programContent, exerciseInPrograms, exercises } from '../db/schema';
import { CreateWorkoutProgramDto } from './dto/create-workout-program.dto';
import { UpdateWorkoutProgramDto } from './dto/update-workout-program.dto';

@Injectable()
export class WorkoutProgramsService {
  async createProgram(userId: number, dto: CreateWorkoutProgramDto) {
    try {
      const [program] = await db
        .insert(workoutPrograms)
        .values({ name: dto.name.trim(), createdById: userId })
        .returning();
      return program;
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('A program with this name already exists');
      throw error;
    }
  }

  async updateProgram(id: number, dto: UpdateWorkoutProgramDto) {
    if (!dto.name) return this.getProgramById(id);

    try {
      const [program] = await db
        .update(workoutPrograms)
        .set({ name: dto.name.trim() })
        .where(eq(workoutPrograms.id, id))
        .returning();
      if (!program) throw new NotFoundException('Workout program not found');
      return program;
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('A program with this name already exists');
      throw error;
    }
  }

  async getAllPrograms() {
    return db.select().from(workoutPrograms);
  }

  async getProgramById(id: number) {
    const [program] = await db
      .select()
      .from(workoutPrograms)
      .where(eq(workoutPrograms.id, id))
      .limit(1);

    if (!program) {
      throw new NotFoundException('Workout program not found');
    }

    const schedule = await db
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
        },
      })
      .from(programContent)
      .leftJoin(exerciseInPrograms, eq(programContent.id, exerciseInPrograms.programContentId))
      .leftJoin(exercises, eq(exerciseInPrograms.exerciseId, exercises.id))
      .where(eq(programContent.programId, id));

    return {
      ...program,
      schedule,
    };
  }
}
