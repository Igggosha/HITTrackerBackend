import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { readerFor, recordWrite } from '../db/read-consistency';
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
  UpdateSetDto,
  WorkoutHistoryDatesDto,
} from './dto/workout.dto';
import { openWorkoutStatuses } from './workout-status.utils';
import {
  activeDurationSeconds,
  isWorkoutInactive,
  WORKOUT_INACTIVITY_LIMIT_MS,
  workoutAutoPauseAt,
} from './workout-timing.utils';
import { hasMinimumRole } from '../auth/roles';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyKeywords,
  planCompletion,
} from './history.utils';
import { OutboxService } from '../outbox/outbox.service';
import { performedSetsPayload } from '../outbox/events';
import type { DbTransaction } from '../outbox/transaction';

// Namespace of the per-user advisory lock that serializes workout starts
// (42719 is the username lock in UsersService).
export const WORKOUT_START_LOCK_NAMESPACE = 42720;

@Injectable()
export class WorkoutsService {
  constructor(private readonly outbox: OutboxService) {}

  private openWorkoutCondition(workoutId: number, userId: number) {
    return and(
      eq(workouts.id, workoutId),
      eq(workouts.userId, userId),
      isNull(workouts.finishedAt),
      inArray(workouts.status, [...openWorkoutStatuses]),
    );
  }

  /**
   * Locks an open workout row until the transaction ends. Every state change
   * of a workout (sets, pause, finish) goes through this lock, so a set can no
   * longer be written into a workout that is being finished, and two finishes
   * cannot both see it as open.
   */
  private async lockOpenWorkout(tx: DbTransaction, workoutId: number, userId: number) {
    const [workout] = await tx
      .select()
      .from(workouts)
      .where(this.openWorkoutCondition(workoutId, userId))
      .for('update')
      .limit(1);
    return workout;
  }

  private async autoPauseIfInactive(
    workout: typeof workouts.$inferSelect,
    now: Date,
    tx: DbTransaction,
  ) {
    if (workout.status !== 'active' || !isWorkoutInactive(workout.lastActivityAt, now)) {
      return { workout, autoPaused: false };
    }

    // Compare-and-set: only one concurrent request can auto-pause the workout.
    const staleBefore = new Date(now.getTime() - WORKOUT_INACTIVITY_LIMIT_MS);
    const [pausedWorkout] = await tx
      .update(workouts)
      .set({
        status: 'paused',
        pausedAt: workoutAutoPauseAt(workout.lastActivityAt),
      })
      .where(and(
        eq(workouts.id, workout.id),
        eq(workouts.status, 'active'),
        lte(workouts.lastActivityAt, staleBefore),
      ))
      .returning();

    if (pausedWorkout) {
      return { workout: pausedWorkout, autoPaused: true };
    }

    const [currentWorkout] = await tx
      .select()
      .from(workouts)
      .where(eq(workouts.id, workout.id))
      .limit(1);
    return { workout: currentWorkout ?? workout, autoPaused: false };
  }

  private async touchActiveWorkout(tx: DbTransaction, workoutId: number, userId: number) {
    const [updatedWorkout] = await tx
      .update(workouts)
      .set({ lastActivityAt: new Date() })
      .where(and(
        eq(workouts.id, workoutId),
        eq(workouts.userId, userId),
        eq(workouts.status, 'active'),
        isNull(workouts.finishedAt),
      ))
      .returning();
    return updatedWorkout;
  }

  /**
   * 1. Запуск нового тренування
   *
   * Safe to retry: starts of one user are serialized by an advisory lock, and
   * a start that finds an open workout returns it instead of creating another.
   */
  async startWorkout(userId: number, userRole: UserRole, body: StartWorkoutDto) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${WORKOUT_START_LOCK_NAMESPACE}, ${userId})`,
      );

      const [existingWorkout] = await tx
        .select()
        .from(workouts)
        .where(and(eq(workouts.userId, userId), isNull(workouts.finishedAt), inArray(workouts.status, [...openWorkoutStatuses])))
        .limit(1);

      if (existingWorkout) {
        const { workout } = await this.autoPauseIfInactive(existingWorkout, new Date(), tx);
        return {
          message: 'Active workout already in progress',
          workout: {
            ...workout,
            // Переконуємось, що дата у строгому ISO-форматі UTC
            createdAt: new Date(workout.createdAt).toISOString(),
          },
        };
      }

      const now = new Date();

      let source: { programId: number; programName: string; scheduledFor: string | null } | null = null;

      if (body?.scheduleId) {
        const [assignment] = await tx
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
        const [program] = await tx
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
        ? await tx.select({ id: exercises.id, name: exercises.name }).from(exercises).where(inArray(exercises.id, exerciseIds))
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

      const [newWorkout] = await tx
        .insert(workouts)
        .values({
          userId,
          type: body?.type || 'HIT Session',
          programContentId: body?.programContentId ?? null,
          scheduleId: body?.scheduleId ?? null,
          historySnapshot,
          status: 'active',
          createdAt: now,
          lastActivityAt: now,
        })
        .returning();

      await this.outbox.enqueue(tx, {
        type: 'workout.started',
        aggregateId: newWorkout.id,
        payload: {
          workoutId: newWorkout.id,
          userId,
          type: newWorkout.type,
          programId: historySnapshot.programId,
          scheduleId: newWorkout.scheduleId,
          plannedExerciseIds: exerciseIds,
          startedAt: newWorkout.createdAt.toISOString(),
        },
      });

      return {
        message: 'Workout started',
        workout: {
          ...newWorkout,
          // Повертаємо стандартизовану ISO-дату, щоб уникнути зсуву таймера на фронтенді
          createdAt: new Date(newWorkout.createdAt).toISOString(),
        },
      };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  /**
   * 2. Отримання поточного активного тренування з його сетами
   */
  async getActiveWorkout(userId: number) {
    const result = await db.transaction(async (tx) => {
      const [openWorkout] = await tx
        .select()
        .from(workouts)
        .where(and(
          eq(workouts.userId, userId),
          isNull(workouts.finishedAt),
          inArray(workouts.status, [...openWorkoutStatuses]),
        ))
        .limit(1);

      if (!openWorkout) return { workout: null, sets: [] };

      const { workout, autoPaused } = await this.autoPauseIfInactive(openWorkout, new Date(), tx);
      const rows = await tx
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
        .where(eq(workouts.id, workout.id));

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
        autoPaused,
      };
    });
    // Only an auto-pause writes here; marked after commit, never inside the tx.
    if ('autoPaused' in result && result.autoPaused) recordWrite(userId);
    return result;
  }

  /**
   * 3. Запис підходу (сету)
   */
  async recordSet(workoutId: number, userId: number, body: RecordSetDto) {
    const result = await db.transaction(async (tx) => {
      const openWorkout = await this.lockOpenWorkout(tx, workoutId, userId);
      if (!openWorkout) {
        throw new NotFoundException('Active workout not found or already finished');
      }

      const { workout } = await this.autoPauseIfInactive(openWorkout, new Date(), tx);

      const [recordedSet] = await tx
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

      const touchedWorkout = await this.touchActiveWorkout(tx, workout.id, userId);

      return {
        message: 'Set recorded successfully',
        set: recordedSet,
        workout: touchedWorkout ?? workout,
      };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  async updateSet(
    workoutId: number,
    setId: number,
    userId: number,
    body: UpdateSetDto,
  ) {
    const result = await db.transaction(async (tx) => {
      const openWorkout = await this.lockOpenWorkout(tx, workoutId, userId);
      const [ownedSet] = openWorkout
        ? await tx
          .select({ id: sets.id })
          .from(sets)
          .where(and(eq(sets.id, setId), eq(sets.workoutId, workoutId)))
          .limit(1)
        : [];

      if (!openWorkout || !ownedSet) {
        throw new NotFoundException('Active workout set not found');
      }

      const { workout } = await this.autoPauseIfInactive(openWorkout, new Date(), tx);

      const [updatedSet] = await tx
        .update(sets)
        .set({
          weight: body.weight,
          reps: body.reps,
          rpe: body.rpe,
          isFailure: body.isFailure ?? false,
        })
        .where(eq(sets.id, setId))
        .returning();

      const touchedWorkout = await this.touchActiveWorkout(tx, workout.id, userId);

      return { message: 'Set updated successfully', set: updatedSet, workout: touchedWorkout ?? workout };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  /**
   * 4. Завершення тренування
   *
   * Safe to retry: the row lock makes concurrent finishes run one after the
   * other, and every finish after the first returns the stored result without
   * rewriting it or emitting a second `workout.finished` event.
   */
  async finishWorkout(workoutId: number, userId: number, body: FinishWorkoutDto) {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workouts)
        .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
        .for('update')
        .limit(1);

      if (!current) {
        throw new NotFoundException('Workout not found');
      }

      if (current.finishedAt) {
        return {
          message: 'Workout was already finished',
          workout: current,
        };
      }

      // A cancelled workout must never turn into completed history.
      if (current.status === 'cancelled') {
        throw new NotFoundException('Open workout not found');
      }

      const { workout } = await this.autoPauseIfInactive(current, new Date(), tx);
      const finishedAt = new Date();
      const durationSeconds = activeDurationSeconds(workout, finishedAt);

      const [updatedWorkout] = await tx
        .update(workouts)
        .set({
          notes: body?.notes || '',
          durationSeconds,
          finishedAt,
          status: 'completed',
          pausedAt: null,
        })
        .where(eq(workouts.id, workoutId))
        .returning();

      if (workout.scheduleId) {
        await tx
          .update(userProgramSchedule)
          .set({ status: 'completed' })
          .where(and(eq(userProgramSchedule.id, workout.scheduleId), eq(userProgramSchedule.userId, userId)));
      }

      // recordSet/updateSet hold the same row lock, so this is the final set list.
      const performedSets = await tx
        .select()
        .from(sets)
        .where(eq(sets.workoutId, workoutId))
        .orderBy(sets.id);
      const totalSeconds = Math.max(
        0,
        Math.floor((finishedAt.getTime() - workout.createdAt.getTime()) / 1000),
      );

      await this.outbox.enqueue(tx, {
        type: 'workout.finished',
        aggregateId: workoutId,
        payload: {
          workoutId,
          userId,
          programId: workout.historySnapshot?.programId ?? null,
          scheduleId: workout.scheduleId,
          startedAt: workout.createdAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationSeconds,
          pausedSeconds: Math.max(0, totalSeconds - durationSeconds),
          ...performedSetsPayload(performedSets),
        },
      });

      return {
        message: 'Workout finished successfully',
        workout: updatedWorkout,
      };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
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

    // Pure browsing read: session consistency (readerFor), not always-primary.
    const reader = readerFor(userId);
    const query = reader
      .select({ workout: workouts })
      .from(workouts)
      .where(and(...conditions))
      .orderBy(desc(workouts.finishedAt), desc(workouts.id));
    const page = dto.limit ? await query.limit(dto.limit + 1) : await query;
    const hasMore = !!dto.limit && page.length > dto.limit;
    const selected = hasMore ? page.slice(0, dto.limit) : page;

    if (!selected.length) return { items: [], nextCursor: null };
    const selectedIds = selected.map(({ workout }) => workout.id);
    const actualRows = await reader
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
    // Pure browsing read: session consistency (readerFor), not always-primary.
    const rows = await readerFor(userId)
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
    // Pure browsing read: session consistency (readerFor), not always-primary.
    const reader = readerFor(userId);
    const [workout] = await reader
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

    const actualRows = await reader
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
      const [program] = await reader.select({
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
        const [assignment] = await reader.select({ id: userProgramSchedule.id })
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
    const result = await db.transaction(async (tx) => {
      // Locked, so a double tap toggles twice instead of both requests pausing,
      // and a finish that commits first is never overwritten back to open.
      const openWorkout = await this.lockOpenWorkout(tx, workoutId, userId);
      if (!openWorkout) throw new NotFoundException('Open workout not found');

      const { workout, autoPaused } = await this.autoPauseIfInactive(openWorkout, new Date(), tx);
      if (autoPaused) return { workout, autoPaused };

      const now = new Date();
      const isPausing = workout.status === 'active';
      const pausedSeconds = isPausing
        ? workout.pausedSeconds
        : workout.pausedSeconds + Math.max(0, Math.floor((now.getTime() - new Date(workout.pausedAt!).getTime()) / 1000));
      const [updatedWorkout] = await tx.update(workouts).set({
        status: isPausing ? 'paused' : 'active',
        pausedAt: isPausing ? now : null,
        pausedSeconds,
        lastActivityAt: isPausing ? workout.lastActivityAt : now,
      }).where(eq(workouts.id, workoutId)).returning();
      return { workout: updatedWorkout };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  async heartbeat(workoutId: number, userId: number) {
    // No row lock: both writes below are compare-and-set updates, and the
    // heartbeat is too frequent to queue behind set writes.
    const result = await db.transaction(async (tx) => {
      const [openWorkout] = await tx
        .select()
        .from(workouts)
        .where(this.openWorkoutCondition(workoutId, userId))
        .limit(1);
      if (!openWorkout) throw new NotFoundException('Open workout not found');

      const { workout, autoPaused } = await this.autoPauseIfInactive(openWorkout, new Date(), tx);
      if (workout.status !== 'active') return { workout, autoPaused };

      return {
        workout: await this.touchActiveWorkout(tx, workout.id, userId),
        autoPaused: false,
      };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  async cancelWorkout(workoutId: number, userId: number) {
    const result = await db.transaction(async (tx) => {
      // One conditional statement: a finish that committed first makes this
      // match nothing, so a completed workout is never flipped to cancelled.
      const [updatedWorkout] = await tx
        .update(workouts)
        .set({ status: 'cancelled', pausedAt: null })
        .where(this.openWorkoutCondition(workoutId, userId))
        .returning();
      if (!updatedWorkout) throw new NotFoundException('Open workout not found');

      const [{ setCount }] = await tx
        .select({ setCount: count() })
        .from(sets)
        .where(eq(sets.workoutId, workoutId));
      await this.outbox.enqueue(tx, {
        type: 'workout.cancelled',
        aggregateId: workoutId,
        payload: {
          workoutId,
          userId,
          startedAt: updatedWorkout.createdAt.toISOString(),
          cancelledAt: new Date().toISOString(),
          setCount,
        },
      });
      return { workout: updatedWorkout };
    });
    // Marked after commit, never inside the tx: a rollback must not count as a write.
    recordWrite(userId);
    return result;
  }

  /**
   * 6. Видалення / Скасування тренування
   */
  async deleteWorkout(workoutId: number, userId: number) {
    await db.transaction(async (tx) => {
      const [workout] = await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
        .for('update')
        .limit(1);

      if (!workout) {
        throw new NotFoundException('Workout not found or access denied');
      }

      await tx.delete(sets).where(eq(sets.workoutId, workoutId));
      await tx.delete(workouts).where(eq(workouts.id, workoutId));
    });
    recordWrite(userId);

    return {
      message: 'Workout deleted successfully',
      id: workoutId,
    };
  }

  async getUniqueExerciseIds(userId: number) {
    // Pure browsing read: session consistency (readerFor), not always-primary.
    const rows = await readerFor(userId)
      .select({
        exerciseId: sets.exerciseId,
        exerciseName: exercises.name,
      })
      .from(sets)
      .leftJoin(workouts, eq(sets.workoutId, workouts.id))
      .leftJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(eq(workouts.userId, userId));

    const uniqueExercises = new Map<number, { exerciseId: number; exerciseName: string | null }>();

    for (const row of rows) {
      if (row.exerciseId === null || uniqueExercises.has(row.exerciseId)) continue;
      uniqueExercises.set(row.exerciseId, {
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName ?? null,
      });
    }

    return [...uniqueExercises.values()];
  }

  async getUserSetsByExercise(userId: number, exerciseId: number) {
    // Pure browsing read: session consistency (readerFor), not always-primary.
    const rows = await readerFor(userId)
      .select({
        set: sets,
        exercise: exercises,
        workout: workouts,
      })
      .from(sets)
      .leftJoin(workouts, eq(sets.workoutId, workouts.id))
      .leftJoin(exercises, eq(sets.exerciseId, exercises.id))
      .where(and(eq(workouts.userId, userId), eq(sets.exerciseId, exerciseId)))
      .orderBy(desc(workouts.finishedAt), desc(sets.id));

    return rows.map((row) => ({
      ...row.set,
      exerciseName: row.exercise?.name,
    }));
  }
}
