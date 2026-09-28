import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { db, primaryDb } from '../db/db';
import {
  sets,
  userActivityEvents,
  usernameReservations,
  userBodyMetrics,
  userProgramSchedule,
  users,
  workouts,
  workoutPrograms,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';
import { ListUserActivityDto, ListUsersDto } from './dto/list-users.dto';
import {
  CreateBodyMetricDto,
  ListBodyMetricsDto,
} from './dto/body-metrics.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import {
  aggregateBodyMetrics,
  getBodyMetricRangeDetails,
} from './body-metrics';
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from './username';
import {
  paginateUserActivity,
  recordUserActivity,
  type AdminUserActivityItem,
} from './user-activity';
import { OutboxService } from '../outbox/outbox.service';
import type { DbTransaction } from '../outbox/transaction';

type AvatarProfile = Awaited<ReturnType<UsersService['getProfile']>>;

const bodyMetricFields = {
  id: userBodyMetrics.id,
  weight: userBodyMetrics.weight,
  bodyFatPercentage: userBodyMetrics.bodyFatPercentage,
  muscleMass: userBodyMetrics.muscleMass,
  waistCircumference: userBodyMetrics.waistCircumference,
  recordedAt: userBodyMetrics.recordedAt,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
    private readonly outbox: OutboxService,
  ) {}

  async listUsers({ search, page, limit, online }: ListUsersDto) {
    const searchFilter = search?.trim()
      ? or(
          ilike(users.email, `%${search.trim()}%`),
          ilike(users.username, `%${search.trim()}%`),
          ilike(users.displayName, `%${search.trim()}%`),
        )
      : undefined;
    const filter = online
      ? and(searchFilter, gte(users.lastSeenAt, new Date(Date.now() - 90_000)))
      : searchFilter;
    const offset = (page - 1) * limit;
    const fields = {
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      online: gte(users.lastSeenAt, new Date(Date.now() - 90_000)),
      createdAt: users.createdAt,
    };

    const [items, [{ total }]] = await Promise.all([
      db
        .select(fields)
        .from(users)
        .where(filter)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(users).where(filter),
    ]);

    return { items, page, limit, total };
  }

  private async getInspectableUser(actorUserId: number, targetUserId: number) {
    const [[actor], [target]] = await Promise.all([
      primaryDb
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1),
      primaryDb.select().from(users).where(eq(users.id, targetUserId)).limit(1),
    ]);
    if (!actor || !hasMinimumRole(actor.role, 'admin')) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (!target) throw new NotFoundException('User not found');
    return target;
  }

  async getAdminUserDetails(actorUserId: number, targetUserId: number) {
    const target = await this.getInspectableUser(actorUserId, targetUserId);
    const [
      latestMetric,
      [workoutStats],
      [programStats],
      [scheduleStats],
      [lastWorkout],
    ] = await Promise.all([
      db
        .select({
          weight: userBodyMetrics.weight,
          bodyFatPercentage: userBodyMetrics.bodyFatPercentage,
          muscleMass: userBodyMetrics.muscleMass,
          recordedAt: userBodyMetrics.recordedAt,
        })
        .from(userBodyMetrics)
        .where(
          and(
            eq(userBodyMetrics.userId, targetUserId),
            isNotNull(userBodyMetrics.weight),
          ),
        )
        .orderBy(desc(userBodyMetrics.recordedAt))
        .limit(1),
      db
        .select({
          completedCount: count(),
          totalDurationSeconds: sql<number>`coalesce(sum(${workouts.durationSeconds}), 0)::int`,
        })
        .from(workouts)
        .where(
          and(
            eq(workouts.userId, targetUserId),
            eq(workouts.status, 'completed'),
            isNotNull(workouts.finishedAt),
          ),
        ),
      db
        .select({ count: count() })
        .from(workoutPrograms)
        .where(
          and(
            eq(workoutPrograms.createdById, targetUserId),
            eq(workoutPrograms.isPersonal, true),
          ),
        ),
      db
        .select({ count: count() })
        .from(userProgramSchedule)
        .where(eq(userProgramSchedule.userId, targetUserId)),
      db
        .select({
          id: workouts.id,
          title: workouts.type,
          finishedAt: workouts.finishedAt,
        })
        .from(workouts)
        .where(
          and(
            eq(workouts.userId, targetUserId),
            eq(workouts.status, 'completed'),
            isNotNull(workouts.finishedAt),
          ),
        )
        .orderBy(desc(workouts.finishedAt))
        .limit(1),
    ]);

    return {
      user: {
        id: target.id,
        email: target.email,
        username: target.username,
        displayName: target.displayName,
        role: target.role,
        age: target.age,
        gender: target.gender,
        height: target.height,
        goal: target.goal,
        avatarUrl: await this.storageService.getUrl(target.avatarKey),
        lastSeenAt: target.lastSeenAt,
        online:
          !!target.lastSeenAt &&
          target.lastSeenAt >= new Date(Date.now() - 90_000),
        createdAt: target.createdAt,
        authMethods: {
          password: !!target.passwordHash,
          google: !!target.googleId,
        },
      },
      latestMetric: latestMetric[0] ?? null,
      stats: {
        completedWorkoutCount: workoutStats?.completedCount ?? 0,
        totalDurationSeconds: workoutStats?.totalDurationSeconds ?? 0,
        personalProgramCount: programStats?.count ?? 0,
        scheduledWorkoutCount: scheduleStats?.count ?? 0,
        lastWorkout: lastWorkout ?? null,
      },
    };
  }

  async getAdminUserActivity(
    actorUserId: number,
    targetUserId: number,
    { page, limit }: ListUserActivityDto,
  ) {
    const target = await this.getInspectableUser(actorUserId, targetUserId);
    const take = page * limit + 1;
    const [logged, completedWorkouts, personalPrograms, schedules, metrics] =
      await Promise.all([
        db
          .select()
          .from(userActivityEvents)
          .where(eq(userActivityEvents.userId, targetUserId))
          .orderBy(desc(userActivityEvents.createdAt))
          .limit(take),
        db
          .select({
            id: workouts.id,
            title: workouts.type,
            finishedAt: workouts.finishedAt,
            durationSeconds: workouts.durationSeconds,
            historySnapshot: workouts.historySnapshot,
            setCount: sql<number>`(select count(*)::int from ${sets} where ${sets.workoutId} = ${workouts.id})`,
          })
          .from(workouts)
          .where(
            and(
              eq(workouts.userId, targetUserId),
              eq(workouts.status, 'completed'),
              isNotNull(workouts.finishedAt),
            ),
          )
          .orderBy(desc(workouts.finishedAt))
          .limit(take),
        db
          .select({
            id: workoutPrograms.id,
            name: workoutPrograms.name,
            sourceProgramId: workoutPrograms.sourceProgramId,
            createdAt: workoutPrograms.createdAt,
          })
          .from(workoutPrograms)
          .where(
            and(
              eq(workoutPrograms.createdById, targetUserId),
              eq(workoutPrograms.isPersonal, true),
            ),
          )
          .orderBy(desc(workoutPrograms.createdAt))
          .limit(take),
        db
          .select({
            id: userProgramSchedule.id,
            programName: workoutPrograms.name,
            scheduledFor: userProgramSchedule.scheduledFor,
            createdAt: userProgramSchedule.createdAt,
          })
          .from(userProgramSchedule)
          .innerJoin(
            workoutPrograms,
            eq(userProgramSchedule.programId, workoutPrograms.id),
          )
          .where(eq(userProgramSchedule.userId, targetUserId))
          .orderBy(desc(userProgramSchedule.createdAt))
          .limit(take),
        db
          .select()
          .from(userBodyMetrics)
          .where(eq(userBodyMetrics.userId, targetUserId))
          .orderBy(desc(userBodyMetrics.recordedAt))
          .limit(take),
      ]);

    const categoryFor = (type: string): AdminUserActivityItem['category'] => {
      if (type.startsWith('role.')) return 'access';
      if (
        type.startsWith('profile.') ||
        type.startsWith('username.') ||
        type.startsWith('avatar.')
      ) {
        return 'profile';
      }
      return 'account';
    };
    const sources: AdminUserActivityItem[][] = [
      logged.map((event) => ({
        id: `event-${event.id}`,
        type: event.type,
        category: categoryFor(event.type),
        occurredAt: event.createdAt,
        metadata: event.metadata,
        actorUserId: event.actorUserId,
      })),
      completedWorkouts.map((workout) => ({
        id: `workout-${workout.id}`,
        type: 'workout.completed',
        category: 'training' as const,
        occurredAt: workout.finishedAt!,
        metadata: {
          title: workout.title,
          durationSeconds: workout.durationSeconds ?? 0,
          setCount: workout.setCount,
          programName: workout.historySnapshot?.programName ?? null,
        },
      })),
      personalPrograms.map((program) => ({
        id: `program-${program.id}`,
        type: program.sourceProgramId ? 'program.imported' : 'program.created',
        category: 'programs' as const,
        occurredAt: program.createdAt,
        metadata: { name: program.name },
      })),
      schedules.map((schedule) => ({
        id: `schedule-${schedule.id}`,
        type: 'schedule.created',
        category: 'programs' as const,
        occurredAt: schedule.createdAt,
        metadata: {
          programName: schedule.programName,
          scheduledFor: schedule.scheduledFor,
        },
      })),
      metrics.map((metric) => ({
        id: `metric-${metric.id}`,
        type: 'body_metric.recorded',
        category: 'profile' as const,
        occurredAt: metric.recordedAt,
        metadata: {
          weight: metric.weight,
          bodyFatPercentage: metric.bodyFatPercentage,
          muscleMass: metric.muscleMass,
        },
      })),
      [
        {
          id: `account-${target.id}`,
          type: 'account.created',
          category: 'account' as const,
          occurredAt: target.createdAt,
          metadata: {},
        },
      ],
    ];
    return paginateUserActivity(sources, page, limit);
  }

  async touchPresence(userId: number) {
    await db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Locks the acting and the target account until the transaction ends, in id
   * order so two admins acting on each other cannot deadlock. Authorization is
   * decided on these locked rows, so a role granted or revoked concurrently
   * cannot slip between the permission check and the write.
   */
  private async lockActorAndTarget(
    tx: DbTransaction,
    actorUserId: number,
    targetUserId: number,
  ) {
    const rows = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.id, [actorUserId, targetUserId]))
      .orderBy(asc(users.id))
      .for('update');
    return {
      actor: rows.find((row) => row.id === actorUserId),
      target: rows.find((row) => row.id === targetUserId),
    };
  }

  async updateUserRole(
    actorUserId: number,
    targetUserId: number,
    role: UserRole,
  ) {
    return db.transaction(async (tx) => {
      const { actor, target } = await this.lockActorAndTarget(
        tx,
        actorUserId,
        targetUserId,
      );

      if (!actor)
        throw new ForbiddenException('Your account no longer has access');
      if (!target) throw new NotFoundException('User not found');
      if (actorUserId === targetUserId) {
        throw new ForbiddenException('You cannot change your own role');
      }

      const isSuperAdmin = actor.role === 'super_admin';
      if (
        !isSuperAdmin &&
        (target.role === 'super_admin' || role === 'super_admin')
      ) {
        throw new ForbiddenException(
          'Only a super admin can manage super admins',
        );
      }
      if (!hasMinimumRole(actor.role, 'admin')) {
        throw new ForbiddenException('Insufficient permissions');
      }

      const [updated] = await tx
        .update(users)
        .set({ role })
        .where(eq(users.id, targetUserId))
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
        });

      if (target.role !== role) {
        await recordUserActivity(
          {
            userId: targetUserId,
            actorUserId,
            type: 'role.changed',
            metadata: { from: target.role, to: role },
          },
          tx,
        );
      }

      return { user: updated };
    });
  }

  async deleteUser(actorUserId: number, targetUserId: number) {
    const deleted = await db.transaction(async (tx) => {
      const { actor, target } = await this.lockActorAndTarget(
        tx,
        actorUserId,
        targetUserId,
      );

      if (!actor)
        throw new ForbiddenException('Your account no longer has access');
      if (!target) throw new NotFoundException('User not found');
      if (actorUserId === targetUserId)
        throw new ForbiddenException('You cannot delete your own account');
      if (!hasMinimumRole(actor.role, 'admin'))
        throw new ForbiddenException('Insufficient permissions');
      if (actor.role !== 'super_admin' && target.role === 'super_admin') {
        throw new ForbiddenException(
          'Only a super admin can manage super admins',
        );
      }

      const [row] = await tx
        .delete(users)
        .where(eq(users.id, targetUserId))
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          avatarKey: users.avatarKey,
        });
      if (!row) throw new NotFoundException('User not found');

      // The outbox row has no foreign key, so it survives the cascade above.
      await this.outbox.enqueue(tx, {
        type: 'user.deleted',
        aggregateId: targetUserId,
        payload: {
          userId: targetUserId,
          deletedByUserId: actorUserId,
          deletedAt: new Date().toISOString(),
        },
      });
      return row;
    });

    // Object storage cannot join the transaction, so the object is removed
    // only after the row that referenced it is gone.
    const { avatarKey, ...deletedUser } = deleted;
    await this.storageService.remove(avatarKey);

    return { user: deletedUser };
  }

  /**
   * Reads the profile. Pass the transaction a preceding write just committed
   * to, so this reaches the primary in the same request instead of a plain
   * `db.select` that could hit a lagging replica and miss that write.
   * Without an executor it defaults to `primaryDb`: profile reads never go
   * to the replica.
   */
  async getProfile(
    userId: number,
    useIdentityContractV2 = false,
    executor: DbTransaction | typeof db = primaryDb,
  ) {
    const [user] = await executor
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        age: users.age,
        gender: users.gender,
        height: users.height,
        goal: users.goal,
        avatarKey: users.avatarKey,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new NotFoundException('User not found');

    const [latestMetric] = await executor
      .select({ weight: userBodyMetrics.weight })
      .from(userBodyMetrics)
      .where(
        and(
          eq(userBodyMetrics.userId, userId),
          isNotNull(userBodyMetrics.weight),
        ),
      )
      .orderBy(desc(userBodyMetrics.recordedAt))
      .limit(1);

    // The object key stays server-side; clients only ever see a signed URL.
    const { avatarKey, ...profile } = user;

    return {
      ...profile,
      username: useIdentityContractV2 ? user.username : user.displayName,
      weight: latestMetric?.weight ?? null,
      avatarUrl: await this.storageService.getUrl(avatarKey),
    };
  }

  /**
   * Replaces the avatar and removes the object it superseded.
   *
   * The new object is written before the row is updated, so a failed upload
   * leaves the current avatar untouched. The previous key is captured inside
   * the same transaction that overwrites it, and its object is deleted only
   * once the row no longer refers to it.
   */
  async updateAvatar(
    userId: number,
    file: UploadedFile | undefined,
    useIdentityContractV2 = false,
  ) {
    const stored = await this.storageService.uploadImage({
      scope: 'avatars',
      ownerId: userId,
      file,
      maxDimension: this.storageService.limits.avatarMaxDimension,
      square: true,
    });

    let result: { replacedKey: string | null; profile: AvatarProfile };
    try {
      result = await this.setAvatarKey(
        userId,
        stored.key,
        useIdentityContractV2,
      );
    } catch (error) {
      // The row was not updated, so nothing points at the new object.
      await this.storageService.remove(stored.key);
      throw error;
    }

    await this.storageService.remove(result.replacedKey);

    return result.profile;
  }

  async removeAvatar(userId: number, useIdentityContractV2 = false) {
    const result = await this.setAvatarKey(userId, null, useIdentityContractV2);
    await this.storageService.remove(result.replacedKey);

    return result.profile;
  }

  /**
   * Swaps the stored avatar key and returns the one that was replaced (so the
   * caller can clean up an object that nothing references any more) together
   * with the fresh profile, read on the primary inside the same transaction
   * as the swap.
   */
  private async setAvatarKey(
    userId: number,
    avatarKey: string | null,
    useIdentityContractV2 = false,
  ): Promise<{ replacedKey: string | null; profile: AvatarProfile }> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('User not found');

      await tx.update(users).set({ avatarKey }).where(eq(users.id, userId));

      if (avatarKey || current.avatarKey) {
        await recordUserActivity(
          {
            userId,
            actorUserId: userId,
            type: avatarKey ? 'avatar.updated' : 'avatar.removed',
          },
          tx,
        );
      }

      const profile = await this.getProfile(userId, useIdentityContractV2, tx);
      return {
        replacedKey: current.avatarKey === avatarKey ? null : current.avatarKey,
        profile,
      };
    });
  }
  async getUsernameAvailability(userId: number, value: unknown) {
    const username = this.validateUsername(value);
    const [[owner], [reservation]] = await Promise.all([
      primaryDb
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = ${username}`)
        .limit(1),
      primaryDb
        .select({ userId: usernameReservations.userId })
        .from(usernameReservations)
        .where(
          and(
            eq(usernameReservations.username, username),
            gt(usernameReservations.reservedUntil, new Date()),
          ),
        )
        .limit(1),
    ]);

    return {
      username,
      available:
        (!owner || owner.id === userId) &&
        (!reservation || reservation.userId === userId),
    };
  }

  async createBodyMetric(userId: number, dto: CreateBodyMetricDto) {
    const details = getBodyMetricRangeDetails(dto);
    if (details.length) {
      throw new BadRequestException({
        code: 'BODY_METRIC_OUT_OF_RANGE',
        details,
      });
    }

    const values = {
      weight: dto.weight ?? null,
      bodyFatPercentage: dto.bodyFatPercentage ?? null,
      muscleMass: dto.muscleMass ?? null,
      waistCircumference: dto.waistCircumference ?? null,
    };
    if (Object.values(values).every((value) => value === null)) {
      throw new BadRequestException({ code: 'BODY_METRIC_REQUIRED' });
    }

    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      throw new BadRequestException({ code: 'BODY_METRIC_INVALID_DATE' });
    }
    if (recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException({ code: 'BODY_METRIC_FUTURE_DATE' });
    }

    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(userBodyMetrics)
        .values({ userId, ...values, recordedAt })
        .returning(bodyMetricFields);
      await this.enqueueBodyMetricRecorded(tx, userId, created, 'body_metrics');
      return created;
    });
  }

  private async enqueueBodyMetricRecorded(
    tx: DbTransaction,
    userId: number,
    metric: {
      id: number;
      weight: number | null;
      bodyFatPercentage: number | null;
      muscleMass: number | null;
      waistCircumference: number | null;
      recordedAt: Date;
    },
    source: 'body_metrics' | 'profile',
  ) {
    await this.outbox.enqueue(tx, {
      type: 'body_metric.recorded',
      aggregateId: userId,
      payload: {
        metricId: metric.id,
        userId,
        weight: metric.weight,
        bodyFatPercentage: metric.bodyFatPercentage,
        muscleMass: metric.muscleMass,
        waistCircumference: metric.waistCircumference,
        recordedAt: metric.recordedAt.toISOString(),
        source,
      },
    });
  }

  async getBodyMetrics(userId: number, dto: ListBodyMetricsDto) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (
      !dto.from ||
      !dto.to ||
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to ||
      to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException({ code: 'INVALID_PERIOD' });
    }

    const rows = await db
      .select({
        id: userBodyMetrics.id,
        weight: userBodyMetrics.weight,
        bodyFatPercentage: userBodyMetrics.bodyFatPercentage,
        muscleMass: userBodyMetrics.muscleMass,
        waistCircumference: userBodyMetrics.waistCircumference,
        recordedAt: userBodyMetrics.recordedAt,
      })
      .from(userBodyMetrics)
      .where(
        and(
          eq(userBodyMetrics.userId, userId),
          lte(userBodyMetrics.recordedAt, to),
        ),
      )
      .orderBy(asc(userBodyMetrics.recordedAt), asc(userBodyMetrics.id));

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      metrics: aggregateBodyMetrics(rows, from, to),
    };
  }

  async updateProfile(
    userId: number,
    dto: UpdateProfileDto,
    useIdentityContractV2 = false,
  ) {
    const {
      weight,
      username: legacyDisplayName,
      displayName,
      ...profile
    } = dto;
    const requestedDisplayName = displayName ?? legacyDisplayName;
    const normalizedDisplayName = requestedDisplayName?.trim();
    if (requestedDisplayName !== undefined && !normalizedDisplayName) {
      throw new BadRequestException({
        message: 'Display name is required',
        code: 'INVALID_DISPLAY_NAME',
      });
    }
    const changes = {
      ...profile,
      ...(profile.email ? { email: profile.email.trim().toLowerCase() } : {}),
      ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
    };
    const hasChanges = Object.keys(changes).length > 0;
    try {
      // Profile fields, the optional weight entry, its outbox event and the
      // activity row commit together. The row lock keeps the "from" values in
      // the activity entry exact when two edits race. The response is read
      // back in the same transaction, on the primary.
      return await db.transaction(async (tx) => {
        const [previous] = hasChanges
          ? await tx
              .select({
                email: users.email,
                displayName: users.displayName,
                age: users.age,
                gender: users.gender,
                height: users.height,
                goal: users.goal,
              })
              .from(users)
              .where(eq(users.id, userId))
              .for('update')
              .limit(1)
          : [];

        if (hasChanges) {
          const updated = await tx
            .update(users)
            .set(changes)
            .where(eq(users.id, userId))
            .returning({ id: users.id });
          if (!updated.length) throw new NotFoundException('User not found');
        }

        if (weight !== undefined) {
          const [metric] = await tx
            .insert(userBodyMetrics)
            .values({ userId, weight })
            .returning(bodyMetricFields);
          await this.enqueueBodyMetricRecorded(tx, userId, metric, 'profile');
        }

        if (previous && hasChanges) {
          const changedFields = Object.entries(changes)
            .filter(
              ([field, value]) =>
                previous[field as keyof typeof previous] !== value,
            )
            .map(([field, value]) => ({
              field,
              from: previous[field as keyof typeof previous] ?? null,
              to: value ?? null,
            }));
          if (changedFields.length) {
            await recordUserActivity(
              {
                userId,
                actorUserId: userId,
                type: 'profile.updated',
                metadata: { changes: changedFields },
              },
              tx,
            );
          }
        }

        return this.getProfile(userId, useIdentityContractV2, tx);
      });
    } catch (error: unknown) {
      const databaseError = error as { code?: string };
      if (databaseError.code === '23505') {
        throw new ConflictException({
          message: 'Email is already in use',
          code: 'EMAIL_ALREADY_EXISTS',
        });
      }
      throw error;
    }
  }

  async updateUsername(userId: number, value: unknown) {
    const normalizedUsername = this.validateUsername(value);
    try {
      // The response is read back in the same transaction, on the primary.
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(42719, ${userId})`);

        const [currentUser] = await tx
          .select({ username: users.username })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!currentUser) throw new NotFoundException('User not found');

        const currentUsername = currentUser.username
          ? normalizeUsername(currentUser.username)
          : null;
        if (normalizedUsername !== currentUsername) {
          const usernamesToLock = [currentUsername, normalizedUsername]
            .filter((value): value is string => Boolean(value))
            .sort();
          for (const usernameToLock of usernamesToLock) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${usernameToLock}))`,
            );
          }

          const [reservation] = await tx
            .select({ userId: usernameReservations.userId })
            .from(usernameReservations)
            .where(
              and(
                eq(usernameReservations.username, normalizedUsername),
                gt(usernameReservations.reservedUntil, new Date()),
              ),
            )
            .limit(1);
          if (reservation && reservation.userId !== userId) {
            throw new ConflictException({
              message: 'Username is already in use',
              code: 'USERNAME_ALREADY_EXISTS',
            });
          }

          const reservationMinutes = Number(
            this.configService.get('USERNAME_RESERVATION_MINUTES') ?? 25,
          );
          const reservedUntil = new Date(
            Date.now() + reservationMinutes * 60_000,
          );
          if (currentUsername) {
            await tx
              .insert(usernameReservations)
              .values({
                username: currentUsername,
                userId,
                reservedUntil,
              })
              .onConflictDoUpdate({
                target: usernameReservations.username,
                set: { userId, reservedUntil },
              });
          }
          await tx
            .delete(usernameReservations)
            .where(
              and(
                eq(usernameReservations.username, normalizedUsername),
                eq(usernameReservations.userId, userId),
              ),
            );
        }

        const updated = await tx
          .update(users)
          .set({ username: normalizedUsername })
          .where(eq(users.id, userId))
          .returning({ id: users.id });
        if (!updated.length) throw new NotFoundException('User not found');

        if (currentUsername !== normalizedUsername) {
          await recordUserActivity(
            {
              userId,
              actorUserId: userId,
              type: 'username.changed',
              metadata: { from: currentUsername, to: normalizedUsername },
            },
            tx,
          );
        }

        return this.getProfile(userId, true, tx);
      });
    } catch (error: unknown) {
      const databaseError = error as { code?: string };
      if (databaseError.code === '23505') {
        throw new ConflictException({
          message: 'Username is already in use',
          code: 'USERNAME_ALREADY_EXISTS',
        });
      }
      throw error;
    }
  }

  private validateUsername(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException({
        message: 'Username format is invalid',
        code: 'INVALID_USERNAME',
      });
    }
    const username = normalizeUsername(value);
    if (!isValidUsername(username)) {
      throw new BadRequestException({
        message: 'Username format is invalid',
        code: 'INVALID_USERNAME',
      });
    }
    if (isReservedUsername(username)) {
      throw new BadRequestException({
        message: 'Username is reserved',
        code: 'USERNAME_RESERVED',
      });
    }
    return username;
  }
}
