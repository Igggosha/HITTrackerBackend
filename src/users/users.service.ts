import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, desc, eq, gt, gte, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/db';
import {
  usernameReservations,
  userBodyMetrics,
  users,
  type UserRole,
} from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';
import {
  isReservedUsername,
  isValidUsername,
  normalizeUsername,
} from './username';

@Injectable()
export class UsersService {
  constructor(
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
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

  async touchPresence(userId: number) {
    await db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updateUserRole(
    actorUserId: number,
    targetUserId: number,
    role: UserRole,
  ) {
    const [[actor], [target]] = await Promise.all([
      db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1),
      db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1),
    ]);

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

    const [updated] = await db
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

    return { user: updated };
  }

  async deleteUser(actorUserId: number, targetUserId: number) {
    const [[actor], [target]] = await Promise.all([
      db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1),
      db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1),
    ]);

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

    const [deleted] = await db
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
    if (!deleted) throw new NotFoundException('User not found');

    const { avatarKey, ...deletedUser } = deleted;
    await this.storageService.remove(avatarKey);

    return { user: deletedUser };
  }

  async getProfile(userId: number, useIdentityContractV2 = false) {
    const [user] = await db
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

    const [latestMetric] = await db
      .select({ weight: userBodyMetrics.weight })
      .from(userBodyMetrics)
      .where(eq(userBodyMetrics.userId, userId))
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

    let replacedKey: string | null;
    try {
      replacedKey = await this.setAvatarKey(userId, stored.key);
    } catch (error) {
      // The row was not updated, so nothing points at the new object.
      await this.storageService.remove(stored.key);
      throw error;
    }

    await this.storageService.remove(replacedKey);

    return this.getProfile(userId, useIdentityContractV2);
  }

  async removeAvatar(userId: number, useIdentityContractV2 = false) {
    const replacedKey = await this.setAvatarKey(userId, null);
    await this.storageService.remove(replacedKey);

    return this.getProfile(userId, useIdentityContractV2);
  }

  /**
   * Swaps the stored avatar key and returns the one that was replaced, so the
   * caller can clean up an object that nothing references any more.
   */
  private async setAvatarKey(
    userId: number,
    avatarKey: string | null,
  ): Promise<string | null> {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select({ avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, userId))
        .for('update')
        .limit(1);
      if (!current) throw new NotFoundException('User not found');

      await tx.update(users).set({ avatarKey }).where(eq(users.id, userId));

      return current.avatarKey === avatarKey ? null : current.avatarKey;
    });
  }

  async getUsernameAvailability(userId: number, value: unknown) {
    const username = this.validateUsername(value);
    const [[owner], [reservation]] = await Promise.all([
      db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = ${username}`)
        .limit(1),
      db
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

    try {
      if (Object.keys(changes).length) {
        const updated = await db
          .update(users)
          .set(changes)
          .where(eq(users.id, userId))
          .returning({ id: users.id });
        if (!updated.length) throw new NotFoundException('User not found');
      }
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

    if (weight !== undefined) {
      await db.insert(userBodyMetrics).values({ userId, weight });
    }

    return this.getProfile(userId, useIdentityContractV2);
  }

  async updateUsername(userId: number, value: unknown) {
    const normalizedUsername = this.validateUsername(value);
    try {
      await db.transaction(async (tx) => {
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

    return this.getProfile(userId, true);
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
