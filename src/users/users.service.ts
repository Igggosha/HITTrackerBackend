import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db/db';
import { userBodyMetrics, users, type UserRole } from '../db/schema';
import { hasMinimumRole } from '../auth/roles';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  async listUsers({ search, page, limit }: ListUsersDto) {
    const filter = search?.trim()
      ? or(ilike(users.email, `%${search.trim()}%`), ilike(users.username, `%${search.trim()}%`))
      : undefined;
    const offset = (page - 1) * limit;
    const fields = {
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    };

    const [items, [{ total }]] = await Promise.all([
      db.select(fields).from(users).where(filter).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(users).where(filter),
    ]);

    return { items, page, limit, total };
  }

  async updateUserRole(actorUserId: number, targetUserId: number, role: UserRole) {
    const [[actor], [target]] = await Promise.all([
      db.select({ role: users.role }).from(users).where(eq(users.id, actorUserId)).limit(1),
      db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, targetUserId)).limit(1),
    ]);

    if (!actor) throw new ForbiddenException('Your account no longer has access');
    if (!target) throw new NotFoundException('User not found');
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('You cannot change your own role');
    }

    const isSuperAdmin = actor.role === 'super_admin';
    if (!isSuperAdmin && (target.role === 'super_admin' || role === 'super_admin')) {
      throw new ForbiddenException('Only a super admin can manage super admins');
    }
    if (!hasMinimumRole(actor.role, 'admin')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const [updated] = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, targetUserId))
      .returning({ id: users.id, email: users.email, username: users.username, role: users.role });

    return { user: updated };
  }

  async getProfile(userId: number) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        age: users.age,
        gender: users.gender,
        height: users.height,
        goal: users.goal,
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

    return { ...user, weight: latestMetric?.weight ?? null };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const { weight, ...profile } = dto;
    const changes = {
      ...profile,
      ...(profile.email ? { email: profile.email.trim().toLowerCase() } : {}),
      ...(profile.username ? { username: profile.username.trim() } : {}),
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
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('Email or username is already in use');
      throw error;
    }

    if (weight !== undefined) {
      await db.insert(userBodyMetrics).values({ userId, weight });
    }

    return this.getProfile(userId);
  }
}
