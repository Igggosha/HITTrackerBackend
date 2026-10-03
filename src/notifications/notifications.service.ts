import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm';
import { primaryDb } from '../db/db';
import {
  notificationCampaigns,
  notificationDeliveries,
  notificationMedia,
  notificationPreferences,
  notifications,
  pushDevices,
  users,
} from '../db/schema';
import type { DbTransaction } from '../outbox/transaction';
import { StorageService } from '../storage/storage.service';
import type { UploadedFile } from '../storage/upload-validation';
import type {
  CreateAdminNotificationDto,
  NotificationCategory,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification.dto';
import { PushTokenCrypto, hashPushToken } from './push-token.crypto';
import { zonedLocalDateTimeToUtc } from './reminder-schedule';

const categoryPreference = {
  general: 'generalEnabled',
  workout: 'workoutRemindersEnabled',
  measurements: 'measurementRemindersEnabled',
  achievements: 'achievementsEnabled',
  news: 'newsEnabled',
} as const;
const ADMIN_NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_DELIVERY_BACKFILL_LIMIT = 25;

type NotificationInput = {
  category: NotificationCategory;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  scheduledAt?: Date;
  scheduledLocalAt?: string;
  expiresAt?: Date;
  dedupeKey?: string;
  campaignId?: string;
  mediaId?: string;
  mediaIds?: string[];
  videoUrls?: string[];
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly tokenCrypto: PushTokenCrypto,
    private readonly storage: StorageService,
  ) {}

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
      const [device] = await tx
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
        })
        .returning({ id: pushDevices.id });
      await tx
        .insert(notificationPreferences)
        .values({ userId })
        .onConflictDoNothing();
      if (token && device) {
        const [preferences] = await tx
          .select({ pushEnabled: notificationPreferences.pushEnabled })
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, userId))
          .limit(1);
        if (preferences?.pushEnabled) {
          const candidates = await tx
            .select({
              id: notifications.id,
              scheduledAt: notifications.scheduledAt,
              scheduledLocalAt: notificationCampaigns.scheduledLocalAt,
            })
            .from(notifications)
            .innerJoin(
              notificationCampaigns,
              eq(notifications.campaignId, notificationCampaigns.id),
            )
            .where(
              and(
                eq(notifications.userId, userId),
                isNotNull(notifications.campaignId),
                isNull(notifications.readAt),
                or(
                  isNull(notifications.expiresAt),
                  gt(notifications.expiresAt, now),
                ),
              ),
            )
            .orderBy(desc(notifications.createdAt))
            .limit(LOGIN_DELIVERY_BACKFILL_LIMIT);
          if (candidates.length) {
            await tx
              .insert(notificationDeliveries)
              .values(
                candidates.map((notification) => ({
                  userId,
                  notificationId: notification.id,
                  pushDeviceId: device.id,
                  nextAttemptAt: (() => {
                    const local = notification.scheduledLocalAt
                      ? zonedLocalDateTimeToUtc(
                          notification.scheduledLocalAt,
                          dto.timeZone ?? 'UTC',
                        )
                      : null;
                    const dueAt = local ?? notification.scheduledAt;
                    return dueAt > now ? dueAt : now;
                  })(),
                })),
              )
              .onConflictDoNothing();
          }
        }
      }
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
    const mediaIds = [
      ...new Set(
        items.flatMap((item) =>
          item.mediaIds?.length
            ? item.mediaIds
            : item.mediaId
              ? [item.mediaId]
              : [],
        ),
      ),
    ];
    const mediaRows = mediaIds.length
      ? await primaryDb
          .select({
            id: notificationMedia.id,
            key: notificationMedia.objectKey,
          })
          .from(notificationMedia)
          .where(inArray(notificationMedia.id, mediaIds))
      : [];
    const mediaUrls = await this.storage.getUrls(
      mediaRows.map((row) => row.key),
    );
    const urlByMediaId = new Map(
      mediaRows.map((row, index) => [row.id, mediaUrls[index]]),
    );
    return {
      items: items.map((item) => {
        const itemMediaIds = item.mediaIds?.length
          ? item.mediaIds
          : item.mediaId
            ? [item.mediaId]
            : [];
        const imageUrls = itemMediaIds
          .map((id) => urlByMediaId.get(id))
          .filter((url): url is string => Boolean(url));
        const videoUrls = item.videoUrls?.length
          ? item.videoUrls
          : item.payload.videoUrls instanceof Array
            ? item.payload.videoUrls.filter(
                (url): url is string => typeof url === 'string',
              )
            : typeof item.payload.videoUrl === 'string'
              ? [item.payload.videoUrl]
              : [];
        return {
          ...item,
          imageUrls,
          videoUrls,
          payload: {
            ...item.payload,
            ...(imageUrls.length ? { imageUrl: imageUrls[0], imageUrls } : {}),
          },
        };
      }),
      page,
      limit,
      total,
      unreadCount,
    };
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

  async uploadAdminMedia(userId: number, file: UploadedFile | undefined) {
    const stored = await this.storage.uploadImage({
      scope: 'notifications',
      ownerId: userId,
      file,
      maxDimension: this.storage.limits.exerciseImageMaxDimension,
    });
    try {
      const [media] = await primaryDb
        .insert(notificationMedia)
        .values({
          uploadedBy: userId,
          objectKey: stored.key,
          width: stored.width,
          height: stored.height,
        })
        .returning();
      return {
        id: media.id,
        uploadedBy: media.uploadedBy,
        width: media.width,
        height: media.height,
        createdAt: media.createdAt,
        imageUrl: await this.storage.getUrl(media.objectKey),
      };
    } catch (error) {
      await this.storage.remove(stored.key);
      throw error;
    }
  }

  async listAdminMedia() {
    const items = await primaryDb
      .select()
      .from(notificationMedia)
      .orderBy(desc(notificationMedia.createdAt))
      .limit(50);
    const urls = await this.storage.getUrls(
      items.map((item) => item.objectKey),
    );
    return {
      items: items.map((item, index) => ({
        id: item.id,
        uploadedBy: item.uploadedBy,
        width: item.width,
        height: item.height,
        createdAt: item.createdAt,
        imageUrl: urls[index],
      })),
    };
  }

  async listAdminHistory() {
    const items = await primaryDb
      .select()
      .from(notificationCampaigns)
      .orderBy(desc(notificationCampaigns.createdAt))
      .limit(50);
    const mediaIds = [
      ...new Set(
        items.flatMap((item) =>
          item.mediaIds?.length
            ? item.mediaIds
            : item.mediaId
              ? [item.mediaId]
              : [],
        ),
      ),
    ];
    const media = mediaIds.length
      ? await primaryDb
          .select({
            id: notificationMedia.id,
            key: notificationMedia.objectKey,
          })
          .from(notificationMedia)
          .where(inArray(notificationMedia.id, mediaIds))
      : [];
    const urls = await this.storage.getUrls(media.map((item) => item.key));
    const urlById = new Map(media.map((item, index) => [item.id, urls[index]]));
    return {
      items: items.map((item) => {
        const itemMediaIds = item.mediaIds?.length
          ? item.mediaIds
          : item.mediaId
            ? [item.mediaId]
            : [];
        const imageUrls = itemMediaIds
          .map((id) => urlById.get(id))
          .filter((url): url is string => Boolean(url));
        const videoUrls = item.videoUrls?.length
          ? item.videoUrls
          : item.videoUrl
            ? [item.videoUrl]
            : [];
        return {
          ...item,
          imageUrl: imageUrls[0] ?? null,
          imageUrls,
          videoUrl: videoUrls[0] ?? null,
          videoUrls,
        };
      }),
    };
  }

  async createAdminNotification(
    dto: CreateAdminNotificationDto,
    createdBy: number,
  ) {
    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : dto.scheduledLocalAt
        ? undefined
        : new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && scheduledAt && expiresAt <= scheduledAt) {
      throw new BadRequestException({ code: 'INVALID_NOTIFICATION_EXPIRY' });
    }
    const mediaIds = [
      ...new Set([
        ...(dto.imageMediaIds ?? []),
        ...(dto.imageMediaId ? [dto.imageMediaId] : []),
      ]),
    ];
    const videoUrls = [
      ...new Set([
        ...(dto.videoUrls ?? []),
        ...(dto.videoUrl ? [dto.videoUrl] : []),
      ]),
    ];
    if (mediaIds.length > 5 || videoUrls.length > 5) {
      throw new BadRequestException({
        code: 'NOTIFICATION_ATTACHMENT_LIMIT_EXCEEDED',
      });
    }
    if (mediaIds.length) {
      const found = await primaryDb
        .select({ id: notificationMedia.id })
        .from(notificationMedia)
        .where(inArray(notificationMedia.id, mediaIds));
      if (found.length !== mediaIds.length) {
        throw new BadRequestException({ code: 'NOTIFICATION_MEDIA_NOT_FOUND' });
      }
    }
    const payload = {
      ...dto.payload,
      ...(dto.imageUrl ? { imageUrl: dto.imageUrl } : {}),
      ...(videoUrls.length ? { videoUrl: videoUrls[0] } : {}),
      ...(videoUrls.length ? { videoUrls } : {}),
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
      title: dto.title?.trim() ?? '',
      body: dto.body?.trim() ?? '',
      payload,
      scheduledAt,
      scheduledLocalAt: dto.scheduledLocalAt,
      expiresAt,
      dedupeKey: dto.dedupeKey,
      mediaId: mediaIds[0],
      mediaIds,
      videoUrls,
    };
    if (
      !input.title &&
      !input.body &&
      !dto.imageUrl &&
      !mediaIds.length &&
      !videoUrls.length &&
      !dto.actionUrl
    ) {
      throw new BadRequestException({ code: 'EMPTY_NOTIFICATION' });
    }

    return primaryDb.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(notificationCampaigns)
        .values({
          createdBy,
          audience: dto.audience,
          targetUserIds: dto.audience === 'users' ? dto.userIds : null,
          category: input.category,
          title: input.title,
          body: input.body,
          mediaId: input.mediaId,
          mediaIds: input.mediaIds,
          videoUrl: videoUrls[0],
          videoUrls,
          actionUrl: dto.actionUrl,
          scheduledAt,
          scheduledLocalAt: dto.scheduledLocalAt,
        })
        .returning({ id: notificationCampaigns.id });
      input.campaignId = campaign.id;
      let recipientCount = 0;
      let deliveryCount = 0;
      for (const target of targetRows) {
        const result = await this.createForUser(tx, target.id, input, false);
        if (result.notificationId) recipientCount += 1;
        deliveryCount += result.deliveryCount;
      }
      await tx
        .update(notificationCampaigns)
        .set({ recipientCount, deliveryCount })
        .where(eq(notificationCampaigns.id, campaign.id));
      return { campaignId: campaign.id, recipientCount, deliveryCount };
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

    const devices =
      input.scheduledLocalAt || preferences?.pushEnabled
        ? await tx
            .select({ id: pushDevices.id, timeZone: pushDevices.timeZone })
            .from(pushDevices)
            .where(
              and(
                eq(pushDevices.userId, userId),
                eq(pushDevices.permissionStatus, 'granted'),
                isNotNull(pushDevices.tokenHash),
                isNotNull(pushDevices.tokenCiphertext),
                isNull(pushDevices.revokedAt),
              ),
            )
            .orderBy(desc(pushDevices.lastSeenAt))
        : [];
    const resolveLocalSchedule = (timeZone: string | null | undefined) =>
      input.scheduledLocalAt
        ? (zonedLocalDateTimeToUtc(
            input.scheduledLocalAt,
            timeZone ?? preferences?.timeZone ?? 'UTC',
          ) ??
          zonedLocalDateTimeToUtc(
            input.scheduledLocalAt,
            preferences?.timeZone ?? 'UTC',
          ))
        : null;
    const deviceSchedules = devices.map((device) =>
      resolveLocalSchedule(device.timeZone),
    );
    const scheduledAt = input.scheduledLocalAt
      ? ((deviceSchedules.filter(Boolean) as Date[]).sort(
          (left, right) => left.getTime() - right.getTime(),
        )[0] ?? resolveLocalSchedule(null))
      : (input.scheduledAt ?? new Date());
    if (!scheduledAt) {
      throw new BadRequestException({
        code: 'INVALID_LOCAL_NOTIFICATION_TIME',
      });
    }
    const expiresAt =
      input.expiresAt ??
      (input.campaignId
        ? new Date(scheduledAt.getTime() + ADMIN_NOTIFICATION_TTL_MS)
        : undefined);
    if (expiresAt && expiresAt <= scheduledAt) {
      throw new BadRequestException({ code: 'INVALID_NOTIFICATION_EXPIRY' });
    }

    const [notification] = await tx
      .insert(notifications)
      .values({
        userId,
        campaignId: input.campaignId,
        mediaId: input.mediaId,
        mediaIds: input.mediaIds,
        videoUrls: input.videoUrls,
        category: input.category,
        title: input.title,
        body: input.body,
        payload: input.payload,
        scheduledAt,
        expiresAt,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!notification) return { notificationId: null, deliveryCount: 0 };

    if (!preferences?.pushEnabled) {
      return { notificationId: notification.id, deliveryCount: 0 };
    }
    if (devices.length) {
      await tx.insert(notificationDeliveries).values(
        devices.map((device, index) => ({
          userId,
          notificationId: notification.id,
          pushDeviceId: device.id,
          nextAttemptAt: deviceSchedules[index] ?? scheduledAt,
        })),
      );
    }
    return { notificationId: notification.id, deliveryCount: devices.length };
  }
}
