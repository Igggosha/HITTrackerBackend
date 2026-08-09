import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { workoutPrograms, programContent, exerciseInPrograms, exercises } from '../db/schema';

@Injectable()
export class WorkoutProgramsService {
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