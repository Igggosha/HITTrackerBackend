import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/db';
import { workouts, sets, exercises } from '../db/schema';
import { StartWorkoutDto, RecordSetDto, FinishWorkoutDto } from './dto/workout.dto';

@Injectable()
export class WorkoutsService {
  async startWorkout(userId: number, dto: StartWorkoutDto) {
    const [newWorkout] = await db
      .insert(workouts)
      .values({
        userId,
        type: dto.type,
        programContentId: dto.programContentId,
      })
      .returning();

    return {
      message: 'Workout started',
      workout: newWorkout,
    };
  }

  async recordSet(workoutId: number, userId: number, dto: RecordSetDto) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Active workout not found');
    }

    const [recordedSet] = await db
      .insert(sets)
      .values({
        workoutId,
        exerciseId: dto.exerciseId,
        weight: dto.weight,
        reps: dto.reps,
        isFailure: dto.isFailure ?? true,
        isDropSet: dto.isDropSet ?? false,
        rpe: dto.rpe,
      })
      .returning();

    return {
      message: 'Set recorded successfully',
      set: recordedSet,
    };
  }

  async finishWorkout(workoutId: number, userId: number, dto: FinishWorkoutDto) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    const [updatedWorkout] = await db
      .update(workouts)
      .set({ notes: dto.notes })
      .where(eq(workouts.id, workoutId))
      .returning();

    return {
      message: 'Workout finished successfully',
      workout: updatedWorkout,
    };
  }

  async getUserHistory(userId: number) {
    const rows = await db
      .select({
        workout: workouts,
        set: sets,
        exercise: exercises,
      })
      .from(workouts)
      .leftJoin(sets, eq(workouts.id, sets.workoutId))
      .leftJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(eq(workouts.userId, userId))
      .orderBy(desc(workouts.createdAt));

    const historyMap = new Map<number, any>();

    for (const row of rows) {
      const workoutId = row.workout.id;

      if (!historyMap.has(workoutId)) {
        historyMap.set(workoutId, {
          ...row.workout,
          sets: [],
        });
      }

      if (row.set) {
        historyMap.get(workoutId).sets.push({
          ...row.set,
          exercise: row.exercise,
        });
      }
    }

    return Array.from(historyMap.values());
  }

  async deleteWorkout(workoutId: number, userId: number) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Workout not found or access denied');
    }

    // Спочатку видаляємо пов'язані сети, щоб уникнути конфліктів зовнішніх ключів
    await db
      .delete(sets)
      .where(eq(sets.workoutId, workoutId));

    // Потім видаляємо саме тренування
    await db
      .delete(workouts)
      .where(eq(workouts.id, workoutId));

    return {
      message: 'Workout deleted successfully',
      id: workoutId,
    };
  }
}