import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { primaryDb } from '../db/db';
import {
  notificationDeliveries,
  notificationPreferences,
  notifications,
  pushDevices,
  users,
} from '../db/schema';
import type { DbTransaction } from '../outbox/transaction';
import type {
  CreateAdminNotificationDto,
  NotificationCategory,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification.dto';
import { PushTokenCrypto, hashPushToken } from './push-token.crypto';

const categoryPreference = {
  general: 'generalEnabled',
  workout: 'workoutRemindersEnabled',
  measurements: 'measurementRemindersEnabled',
  achievements: 'achievementsEnabled',
  news: 'newsEnabled',
} as const;

type NotificationInput = {
  category: NotificationCategory;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
  expiresAt?: Date;
  dedupeKey?: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly tokenCrypto: PushTokenCrypto) {}

  async getPreferences(userId: number) {
    await primaryDb
      .insert(notificationPreferences)
      .values({ userId })
      .onConflictDoNothing();
    const [preferences] = await primaryDb
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return preferences;
  }

  async updatePreferences(
    userId: number,
    dto: UpdateNotificationPreferencesDto,
  ) {
    if (dto.timeZone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: dto.timeZone }).format();
      } catch {
        throw new BadRequestException({ code: 'INVALID_TIME_ZONE' });
      }
    }
    const current = await this.getPreferences(userId);
    this.assertCadence(
      dto.workoutReminderFrequency ?? current.workoutReminderFrequency,
      dto.workoutReminderDays ?? current.workoutReminderDays,
    );
    this.assertCadence(
      dto.measurementReminderFrequency ?? current.measurementReminderFrequency,
      dto.measurementReminderDays ?? current.measurementReminderDays,
    );
    const values = { ...dto, updatedAt: new Date() };
    const [preferences] = await primaryDb
      .insert(notificationPreferences)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: values,
      })
      .returning();
    return preferences;
  }

  private assertCadence(frequency: string, days: number[]) {
    if (
      (frequency === 'weekly' && days.length !== 1) ||
      (frequency === 'twice_weekly' && days.length !== 2)
    ) {
      throw new BadRequestException({ code: 'INVALID_REMINDER_DAYS' });
    }
  }

  async registerDevice(userId: number, dto: RegisterPushDeviceDto) {
    const now = new Date();
    const token = dto.permissionStatus === 'granted' ? dto.token : undefined;
    if (dto.permissionStatus === 'granted' && !token) {
      throw new BadRequestException({ code: 'PUSH_TOKEN_REQUIRED' });
    }
    const tokenHash = token ? hashPushToken(token) : null;
    const tokenCiphertext = token ? this.tokenCrypto.encrypt(token) : null;

    await primaryDb.transaction(async (tx) => {
      if (tokenHash) {
        await tx
          .update(pushDevices)
          .set({
            tokenHash: null,
            tokenCiphertext: null,
            tokenUpdatedAt: now,
            revokedAt: now,
          })
          .where(eq(pushDevices.tokenHash, tokenHash));
      }
      await tx
        .insert(pushDevices)
        .values({
          userId,
          installationId: dto.installationId,
          platform: dto.platform,
          provider: dto.provider,
          permissionStatus: dto.permissionStatus,
          tokenHash,
          tokenCiphertext,
          tokenUpdatedAt: token ? now : null,
          lastSeenAt: now,
          revokedAt: token ? null : now,
          deviceModel: dto.deviceModel,
          osVersion: dto.osVersion,
          appVersion: dto.appVersion,
          locale: dto.locale,
          timeZone: dto.timeZone,
        })
        .onConflictDoUpdate({
          target: [pushDevices.userId, pushDevices.installationId],
          set: {
            platform: dto.platform,
            provider: dto.provider,
            permissionStatus: dto.permissionStatus,
            tokenHash,
            tokenCiphertext,
            tokenUpdatedAt: token ? now : null,
            lastSeenAt: now,
            revokedAt: token ? null : now,
            deviceModel: dto.deviceModel,
            osVersion: dto.osVersion,
            appVersion: dto.appVersion,
            locale: dto.locale,
            timeZone: dto.timeZone,
          },
        });
      await tx
        .insert(notificationPreferences)
        .values({ userId })
        .onConflictDoNothing();
    });
    return { registered: Boolean(token) };
  }

  async unregisterDevice(userId: number, installationId: string) {
    await primaryDb
      .update(pushDevices)
      .set({
        tokenHash: null,
        tokenCiphertext: null,
        revokedAt: new Date(),
        tokenUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(pushDevices.userId, userId),
          eq(pushDevices.installationId, installationId),
        ),
      );
    return { unregistered: true };
  }

  async list(userId: number, page: number, limit: number) {
    const filter = eq(notifications.userId, userId);
    const unreadFilter = and(filter, isNull(notifications.readAt));
    const offset = (page - 1) * limit;
    const [items, [{ total }], [{ unreadCount }]] = await Promise.all([
      primaryDb
        .select()
        .from(notifications)
        .where(filter)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
        .offset(offset),
      primaryDb.select({ total: count() }).from(notifications).where(filter),
      primaryDb
        .select({ unreadCount: count() })
        .from(notifications)
        .where(unreadFilter),
    ]);
    return { items, page, limit, total, unreadCount };
  }

  async markRead(userId: number, notificationId: string) {
    const [notification] = await primaryDb
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async markAllRead(userId: number) {
    const rows = await primaryDb
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }

  async sendTest(userId: number) {
    const [preferences] = await primaryDb
      .select({ pushEnabled: notificationPreferences.pushEnabled })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    if (!preferences?.pushEnabled) {
      throw new BadRequestException({ code: 'PUSH_NOTIFICATIONS_DISABLED' });
    }
    const result = await primaryDb.transaction((tx) =>
      this.createForUser(
        tx,
        userId,
        {
          category: 'general',
          title: 'Hit Tracker',
          body: 'Push notifications are working.',
          payload: { screen: 'Notifications' },
          dedupeKey: `test:${Date.now()}`,
        },
        true,
      ),
    );
    if (!result.deliveryCount) {
      throw new BadRequestException({ code: 'NO_ACTIVE_PUSH_DEVICE' });
    }
    return result;
  }

  createReminder(
    userId: number,
    category: 'workout' | 'measurements',
    title: string,
    body: string,
    localDate: string,
  ) {
    return primaryDb.transaction((tx) =>
      this.createForUser(
        tx,
        userId,
        {
          category,
          title,
          body,
          payload: { screen: 'Notifications' },
          dedupeKey: `reminder:${category}:${localDate}`,
        },
        false,
      ),
    );
  }

  async createAdminNotification(dto: CreateAdminNotificationDto) {
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && expiresAt <= scheduledAt) {
      throw new BadRequestException({ code: 'INVALID_NOTIFICATION_EXPIRY' });
    }
    const payload = {
      ...dto.payload,
      ...(dto.imageUrl ? { imageUrl: dto.imageUrl } : {}),
      ...(dto.actionUrl ? { actionUrl: dto.actionUrl } : {}),
    };
    if (JSON.stringify(payload).length > 4096) {
      throw new BadRequestException({ code: 'NOTIFICATION_PAYLOAD_TOO_LARGE' });
    }
    if (dto.audience === 'users' && !dto.userIds?.length) {
      throw new BadRequestException({ code: 'NOTIFICATION_USERS_REQUIRED' });
    }

    const targetRows = await primaryDb
      .select({ id: users.id })
      .from(users)
      .where(
        dto.audience === 'users' ? inArray(users.id, dto.userIds!) : undefined,
      );
    const input: NotificationInput = {
      category: dto.category,
      title: dto.title.trim(),
      body: dto.body.trim(),
      payload,
      scheduledAt,
      expiresAt,
      dedupeKey: dto.dedupeKey,
    };
    if (!input.title || !input.body) {
      throw new BadRequestException({ code: 'EMPTY_NOTIFICATION' });
    }

    return primaryDb.transaction(async (tx) => {
      let recipientCount = 0;
      let deliveryCount = 0;
      for (const target of targetRows) {
        const result = await this.createForUser(tx, target.id, input, false);
        if (result.notificationId) recipientCount += 1;
        deliveryCount += result.deliveryCount;
      }
      return { recipientCount, deliveryCount };
    });
  }

  private async createForUser(
    tx: DbTransaction,
    userId: number,
    input: NotificationInput,
    bypassCategoryPreference: boolean,
  ) {
    const [preferences] = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    const categoryEnabled = preferences?.[categoryPreference[input.category]];
    if (!bypassCategoryPreference && !categoryEnabled) {
      return { notificationId: null, deliveryCount: 0 };
    }

    const [notification] = await tx
      .insert(notifications)
      .values({ userId, ...input })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!notification) return { notificationId: null, deliveryCount: 0 };

    if (!preferences?.pushEnabled) {
      return { notificationId: notification.id, deliveryCount: 0 };
    }
    const devices = await tx
      .select({ id: pushDevices.id })
      .from(pushDevices)
      .where(
        and(
          eq(pushDevices.userId, userId),
          eq(pushDevices.permissionStatus, 'granted'),
          isNotNull(pushDevices.tokenHash),
          isNotNull(pushDevices.tokenCiphertext),
          isNull(pushDevices.revokedAt),
        ),
      );
    if (devices.length) {
      await tx.insert(notificationDeliveries).values(
        devices.map((device) => ({
          userId,
          notificationId: notification.id,
          pushDeviceId: device.id,
          nextAttemptAt: input.scheduledAt ?? new Date(),
        })),
      );
    }
    return { notificationId: notification.id, deliveryCount: devices.length };
  }
}
