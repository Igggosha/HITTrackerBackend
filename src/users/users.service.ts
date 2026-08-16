import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/db';
import { userBodyMetrics, users } from '../db/schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  async getProfile(userId: number) {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
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
