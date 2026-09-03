import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, desc, isNull, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db/db';
import { workouts, sets, exercises, userProgramSchedule } from '../db/schema';
import { FinishWorkoutDto, RecordSetDto, StartWorkoutDto } from './dto/workout.dto';
import { openWorkoutStatuses } from './workout-status.utils';

@Injectable()
export class WorkoutsService {
  /**
   * 1. Запуск нового тренування
   */
  async startWorkout(userId: number, body: StartWorkoutDto) {
    const [existingWorkout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), isNull(workouts.finishedAt), inArray(workouts.status, [...openWorkoutStatuses])))
      .limit(1);

    if (existingWorkout) {
      return {
        message: 'Active workout already in progress',
        workout: {
          ...existingWorkout,
          // Переконуємось, що дата у строгому ISO-форматі UTC
          createdAt: new Date(existingWorkout.createdAt).toISOString(),
        },
      };
    }

    const now = new Date();

    if (body?.scheduleId) {
      const [assignment] = await db
        .select({ id: userProgramSchedule.id })
        .from(userProgramSchedule)
        .where(and(eq(userProgramSchedule.id, body.scheduleId), eq(userProgramSchedule.userId, userId)))
        .limit(1);
      if (!assignment) throw new NotFoundException('Scheduled workout not found');
    }

    const [newWorkout] = await db
      .insert(workouts)
      .values({
        userId,
        type: body?.type || 'HIT Session',
        programContentId: body?.programContentId ?? null,
        scheduleId: body?.scheduleId ?? null,
        status: 'active',
        createdAt: now,
      })
      .returning();

    return {
      message: 'Workout started',
      workout: {
        ...newWorkout,
        // Повертаємо стандартизовану ISO-дату, щоб уникнути зсуву таймера на фронтенді
        createdAt: new Date(newWorkout.createdAt).toISOString(),
      },
    };
  }

  /**
   * 2. Отримання поточного активного тренування з його сетами
   */
  async getActiveWorkout(userId: number) {
    const rows = await db
      .select({
        workout: workouts,
        set: sets,
        exercise: exercises,
        programId: userProgramSchedule.programId,
      })
      .from(workouts)
      .leftJoin(sets, eq(workouts.id, sets.workoutId))
      .leftJoin(exercises, eq(sets.exerciseId, exercises.id))
      .leftJoin(userProgramSchedule, eq(workouts.scheduleId, userProgramSchedule.id))
      .where(and(eq(workouts.userId, userId), isNull(workouts.finishedAt), inArray(workouts.status, [...openWorkoutStatuses])));

    if (rows.length === 0) {
      return { workout: null, sets: [] };
    }

    const activeWorkout = {
      ...rows[0].workout,
      programId: rows[0].programId,
      // Форматуємо createdAt для запобігання помилкам часу
      createdAt: new Date(rows[0].workout.createdAt).toISOString(),
    };

    const loggedSets = rows
      .filter((r) => r.set !== null)
      .map((r) => ({
        ...r.set,
        exerciseName: r.exercise?.name,
      }));

    return {
      workout: activeWorkout,
      sets: loggedSets,
    };
  }

  /**
   * 3. Запис підходу (сету)
   */
  async recordSet(workoutId: number, userId: number, body: RecordSetDto) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(
        and(
          eq(workouts.id, workoutId), 
          eq(workouts.userId, userId),
          isNull(workouts.finishedAt),
          inArray(workouts.status, [...openWorkoutStatuses])
        )
      )
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Active workout not found or already finished');
    }

    const [recordedSet] = await db
      .insert(sets)
      .values({
        workoutId,
        exerciseId: body.exerciseId,
        weight: body.weight,
        reps: body.reps,
        isFailure: body.isFailure ?? true,
        isDropSet: body.isDropSet ?? false,
        rpe: body.rpe,
      })
      .returning();

    return {
      message: 'Set recorded successfully',
      set: recordedSet,
    };
  }

  /**
   * 4. Завершення тренування
   */
  async finishWorkout(workoutId: number, userId: number, body: FinishWorkoutDto) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    if (workout.finishedAt) {
      return {
        message: 'Workout was already finished',
        workout,
      };
    }

    // Отримуємо час завершення
    const finishedAt = body?.finishedAt ? new Date(body.finishedAt) : new Date();

    // Читаємо durationSeconds з body або вираховуємо різницю
    let durationSeconds = body?.durationSeconds;
    if (durationSeconds === undefined || durationSeconds === null) {
      const startTime = new Date(workout.createdAt).getTime();
      durationSeconds = Math.max(0, Math.floor((finishedAt.getTime() - startTime) / 1000));
    }

    const [updatedWorkout] = await db
      .update(workouts)
      .set({
        notes: body?.notes || '',
        durationSeconds: Number(durationSeconds),
        finishedAt,
        status: 'completed',
        pausedAt: null,
      })
      .where(eq(workouts.id, workoutId))
      .returning();

    if (workout.scheduleId) {
      await db
        .update(userProgramSchedule)
        .set({ status: 'completed' })
        .where(and(eq(userProgramSchedule.id, workout.scheduleId), eq(userProgramSchedule.userId, userId)));
    }

    return {
      message: 'Workout finished successfully',
      workout: updatedWorkout,
    };
  }

  /**
   * 5. Отримання історії ЗАВЕРШЕНИХ тренувань
   */
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
      .where(
        and(
          eq(workouts.userId, userId),
          isNotNull(workouts.finishedAt),
          eq(workouts.status, 'completed')
        )
      )
      .orderBy(desc(workouts.finishedAt));

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

  async togglePause(workoutId: number, userId: number) {
    const [workout] = await db.select().from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId), isNull(workouts.finishedAt), inArray(workouts.status, [...openWorkoutStatuses])))
      .limit(1);
    if (!workout) throw new NotFoundException('Open workout not found');

    const now = new Date();
    const isPausing = workout.status === 'active';
    const pausedSeconds = isPausing
      ? workout.pausedSeconds
      : workout.pausedSeconds + Math.max(0, Math.floor((now.getTime() - new Date(workout.pausedAt!).getTime()) / 1000));
    const [updatedWorkout] = await db.update(workouts).set({
      status: isPausing ? 'paused' : 'active',
      pausedAt: isPausing ? now : null,
      pausedSeconds,
    }).where(eq(workouts.id, workoutId)).returning();
    return { workout: updatedWorkout };
  }

  async cancelWorkout(workoutId: number, userId: number) {
    const [workout] = await db.select().from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId), isNull(workouts.finishedAt), inArray(workouts.status, [...openWorkoutStatuses])))
      .limit(1);
    if (!workout) throw new NotFoundException('Open workout not found');
    const [updatedWorkout] = await db.update(workouts).set({ status: 'cancelled', pausedAt: null }).where(eq(workouts.id, workoutId)).returning();
    return { workout: updatedWorkout };
  }

  /**
   * 6. Видалення / Скасування тренування
   */
  async deleteWorkout(workoutId: number, userId: number) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
      .limit(1);

    if (!workout) {
      throw new NotFoundException('Workout not found or access denied');
    }

    await db.transaction(async (tx) => {
      await tx.delete(sets).where(eq(sets.workoutId, workoutId));
      await tx.delete(workouts).where(eq(workouts.id, workoutId));
    });

    return {
      message: 'Workout deleted successfully',
      id: workoutId,
    };
  }
}
