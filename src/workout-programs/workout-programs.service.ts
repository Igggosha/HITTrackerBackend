<<<<<<< Updated upstream
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
=======
import { Injectable } from '@nestjs/common';
// import {Muscle} from "./entities/muscle.entity";
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class WorkoutProgramsService {
  constructor(
    // @InjectRepository(Muscle)
    // private readonly musclesRepo: Repository<Muscle>,
  ) {}

  async getHello(): Promise<string> {
    // let count = await this.musclesRepo.count()
    // return count.toString();
    return 'Hello World!';
  }
}
>>>>>>> Stashed changes
