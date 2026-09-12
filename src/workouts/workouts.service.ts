import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
  exercises,
  sets,
  userProgramSchedule,
  workouts,
  workoutPrograms,
  type UserRole,
  type WorkoutHistorySnapshot,
} from '../db/schema';
import {
  FinishWorkoutDto,
  ListWorkoutHistoryDto,
  RecordSetDto,
  StartWorkoutDto,
  WorkoutHistoryDatesDto,
} from './dto/workout.dto';
import { openWorkoutStatuses } from './workout-status.utils';
import { hasMinimumRole } from '../auth/roles';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyKeywords,
  planCompletion,
} from './history.utils';

@Injectable()
export class WorkoutsService {
  /**
   * 1. Запуск нового тренування
   */
  async startWorkout(userId: number, userRole: UserRole, body: StartWorkoutDto) {
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

    let source: { programId: number; programName: string; scheduledFor: string | null } | null = null;

    if (body?.scheduleId) {
      const [assignment] = await db
        .select({
          id: userProgramSchedule.id,
          scheduledFor: userProgramSchedule.scheduledFor,
          programId: workoutPrograms.id,
          programName: workoutPrograms.name,
        })
        .from(userProgramSchedule)
        .innerJoin(workoutPrograms, eq(userProgramSchedule.programId, workoutPrograms.id))
        .where(and(eq(userProgramSchedule.id, body.scheduleId), eq(userProgramSchedule.userId, userId)))
        .limit(1);
      if (!assignment) throw new NotFoundException('Scheduled workout not found');
      source = assignment;
    } else if (body?.programId) {
      const [program] = await db
        .select({
          id: workoutPrograms.id,
          name: workoutPrograms.name,
          isActive: workoutPrograms.isActive,
          isPersonal: workoutPrograms.isPersonal,
          createdById: workoutPrograms.createdById,
        })
        .from(workoutPrograms)
        .where(eq(workoutPrograms.id, body.programId))
        .limit(1);
      const canUse = program && (
        hasMinimumRole(userRole, 'moderator')
        || (program.isPersonal ? program.createdById === userId : program.isActive)
      );
      if (!canUse) throw new NotFoundException('Workout program not found');
      source = { programId: program.id, programName: program.name, scheduledFor: null };
    }

    const planInput = body?.plan || [];
    const exerciseIds = [...new Set(planInput.map((item) => item.exerciseId))];
    const exerciseRows = exerciseIds.length
      ? await db.select({ id: exercises.id, name: exercises.name }).from(exercises).where(inArray(exercises.id, exerciseIds))
      : [];
    const exerciseNames = new Map(exerciseRows.map((exercise) => [exercise.id, exercise.name]));
    if (exerciseNames.size !== exerciseIds.length) throw new NotFoundException('Planned exercise not found');

    const historySnapshot: WorkoutHistorySnapshot = {
      programId: source?.programId ?? null,
      programName: source?.programName ?? null,
      scheduledFor: source?.scheduledFor ?? null,
      plan: planInput.map((item) => ({
        exerciseId: item.exerciseId,
        name: exerciseNames.get(item.exerciseId)!,
        sets: item.sets,
        reps: item.reps ?? null,
        weight: item.weight ?? null,
      })),
    };

    const [newWorkout] = await db
      .insert(workouts)
      .values({
        userId,
        type: body?.type || 'HIT Session',
        programContentId: body?.programContentId ?? null,
        scheduleId: body?.scheduleId ?? null,
        historySnapshot,
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
      programId: rows[0].programId ?? rows[0].workout.historySnapshot?.programId ?? null,
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
   * 5. Cursor-paginated completed workout history.
   */
  async getUserHistory(userId: number, dto: ListWorkoutHistoryDto) {
    if (dto.cursor && !dto.limit) throw new BadRequestException('A history cursor requires a limit');
    const cursor = decodeHistoryCursor(dto.cursor);
    if (dto.cursor && !cursor) throw new BadRequestException('Invalid history cursor');

    const conditions = [
      eq(workouts.userId, userId),
      isNotNull(workouts.finishedAt),
      eq(workouts.status, 'completed'),
    ];
    if (dto.from) conditions.push(gte(workouts.finishedAt, new Date(dto.from)));
    if (dto.to) conditions.push(lt(workouts.finishedAt, new Date(dto.to)));
    if (cursor) {
      conditions.push(or(
        lt(workouts.finishedAt, cursor.finishedAt),
        and(eq(workouts.finishedAt, cursor.finishedAt), lt(workouts.id, cursor.id)),
      )!);
    }

    for (const keyword of historyKeywords(dto.q)) {
      const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(sql<boolean>`(
        lower(${workouts.type}) like ${pattern}
        or lower(coalesce(${workouts.historySnapshot}->>'programName', '')) like ${pattern}
        or exists (
          select 1 from ${sets}
          inner join ${exercises} on ${exercises.id} = ${sets.exerciseId}
          where ${sets.workoutId} = ${workouts.id}
            and lower(${exercises.name}) like ${pattern}
        )
      )`);
    }

    const query = db
      .select({ workout: workouts })
      .from(workouts)
      .where(and(...conditions))
      .orderBy(desc(workouts.finishedAt), desc(workouts.id));
    const page = dto.limit ? await query.limit(dto.limit + 1) : await query;
    const hasMore = !!dto.limit && page.length > dto.limit;
    const selected = hasMore ? page.slice(0, dto.limit) : page;

    if (!selected.length) return { items: [], nextCursor: null };
    const selectedIds = selected.map(({ workout }) => workout.id);
    const actualRows = await db
      .select({
        workoutId: sets.workoutId,
        exerciseId: sets.exerciseId,
        exerciseName: exercises.name,
      })
      .from(sets)
      .innerJoin(exercises, eq(exercises.id, sets.exerciseId))
      .where(inArray(sets.workoutId, selectedIds));
    const actualByWorkout = new Map<number, typeof actualRows>();
    for (const row of actualRows) {
      if (!actualByWorkout.has(row.workoutId)) actualByWorkout.set(row.workoutId, []);
      actualByWorkout.get(row.workoutId)!.push(row);
    }

    const items = selected.map(({ workout }) => {
      const actual = actualByWorkout.get(workout.id) || [];
      const names = [...new Map(actual.map((row) => [row.exerciseId, row.exerciseName])).values()];
      return {
        id: workout.id,
        title: workout.type,
        createdAt: workout.createdAt,
        finishedAt: workout.finishedAt,
        activeDurationSeconds: workout.durationSeconds || 0,
        totalDurationSeconds: Math.max(0, Math.floor(
          (workout.finishedAt!.getTime() - workout.createdAt.getTime()) / 1000,
        )),
        exerciseCount: names.length,
        setCount: actual.length,
        exercisePreview: names.slice(0, 3),
        remainingExerciseCount: Math.max(0, names.length - 3),
        programName: workout.historySnapshot?.programName ?? null,
      };
    });
    const last = selected.at(-1)!.workout;
    return {
      items,
      nextCursor: hasMore ? encodeHistoryCursor(last.finishedAt!, last.id) : null,
    };
  }

  async getHistoryDates(userId: number, dto: WorkoutHistoryDatesDto) {
    const rows = await db
      .select({ finishedAt: workouts.finishedAt })
      .from(workouts)
      .where(and(
        eq(workouts.userId, userId),
        isNotNull(workouts.finishedAt),
        eq(workouts.status, 'completed'),
        gte(workouts.finishedAt, new Date(dto.from)),
        lt(workouts.finishedAt, new Date(dto.to)),
      ));
    return rows.map(({ finishedAt }) => finishedAt!.toISOString());
  }

  async getHistoryDetails(userId: number, userRole: UserRole, workoutId: number) {
    const [workout] = await db
      .select()
      .from(workouts)
      .where(and(
        eq(workouts.id, workoutId),
        eq(workouts.userId, userId),
        isNotNull(workouts.finishedAt),
        eq(workouts.status, 'completed'),
      ))
      .limit(1);
    if (!workout) throw new NotFoundException('Completed workout not found');

    const actualRows = await db
      .select({ set: sets, exerciseName: exercises.name })
      .from(sets)
      .innerJoin(exercises, eq(exercises.id, sets.exerciseId))
      .where(eq(sets.workoutId, workoutId))
      .orderBy(sets.id);
    const plan = workout.historySnapshot?.plan || [];
    const exerciseMap = new Map<number, {
      exerciseId: number;
      name: string;
      planned: (typeof plan)[number] | null;
      actualSets: (typeof actualRows)[number]['set'][];
      addedDuringWorkout: boolean;
    }>();
    for (const item of plan) {
      exerciseMap.set(item.exerciseId, {
        exerciseId: item.exerciseId,
        name: item.name,
        planned: item,
        actualSets: [],
        addedDuringWorkout: false,
      });
    }
    for (const row of actualRows) {
      if (!exerciseMap.has(row.set.exerciseId)) {
        exerciseMap.set(row.set.exerciseId, {
          exerciseId: row.set.exerciseId,
          name: row.exerciseName,
          planned: null,
          actualSets: [],
          addedDuringWorkout: !!workout.historySnapshot,
        });
      }
      exerciseMap.get(row.set.exerciseId)!.actualSets.push(row.set);
    }

    const actualSetCounts = new Map<number, number>();
    for (const row of actualRows) {
      actualSetCounts.set(row.set.exerciseId, (actualSetCounts.get(row.set.exerciseId) || 0) + 1);
    }
    const rpeSets = actualRows.filter(({ set }) => set.rpe !== null);
    const snapshot = workout.historySnapshot;
    let programSource = snapshot?.programName
      ? { id: snapshot.programId, name: snapshot.programName, available: false }
      : null;
    if (programSource?.id) {
      const [program] = await db.select({
        id: workoutPrograms.id,
        isActive: workoutPrograms.isActive,
        isPersonal: workoutPrograms.isPersonal,
        createdById: workoutPrograms.createdById,
      }).from(workoutPrograms).where(eq(workoutPrograms.id, programSource.id)).limit(1);
      let available = !!program && (
        hasMinimumRole(userRole, 'moderator')
        || (program.isPersonal ? program.createdById === userId : program.isActive)
      );
      if (program && !program.isPersonal && !program.isActive && !available) {
        const [assignment] = await db.select({ id: userProgramSchedule.id })
          .from(userProgramSchedule)
          .where(and(eq(userProgramSchedule.userId, userId), eq(userProgramSchedule.programId, program.id)))
          .limit(1);
        available = !!assignment;
      }
      programSource = { ...programSource, available };
    }

    return {
      workout: {
        id: workout.id,
        title: workout.type,
        createdAt: workout.createdAt,
        finishedAt: workout.finishedAt,
        notes: workout.notes,
        scheduledFor: snapshot?.scheduledFor ?? null,
      },
      programSource,
      summary: {
        activeDurationSeconds: workout.durationSeconds || 0,
        totalDurationSeconds: Math.max(0, Math.floor(
          (workout.finishedAt!.getTime() - workout.createdAt.getTime()) / 1000,
        )),
        exerciseCount: new Set(actualRows.map(({ set }) => set.exerciseId)).size,
        setCount: actualRows.length,
        volume: actualRows.reduce((total, { set }) => total + set.weight * set.reps, 0),
        averageRpe: rpeSets.length
          ? rpeSets.reduce((total, { set }) => total + set.rpe!, 0) / rpeSets.length
          : null,
        failureSets: actualRows.filter(({ set }) => set.isFailure).length,
        completionPercent: planCompletion(plan, actualSetCounts),
      },
      exercises: [...exerciseMap.values()],
      hasPlanSnapshot: !!workout.historySnapshot,
    };
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
