import { Inject, Injectable, Logger } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { primaryDb } from '../db/db';
import {
  notificationDeliveries,
  notificationMedia,
  notifications,
  pushDevices,
} from '../db/schema';
import { FIREBASE_APP } from '../firebase/firebase.module';
import { PushTokenCrypto } from './push-token.crypto';
import { StorageService } from '../storage/storage.service';

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

type ClaimedDelivery = {
  id: string;
  pushDeviceId: string;
  attempts: number;
  provider: 'fcm' | 'expo';
  tokenCiphertext: string;
  notificationId: string;
  category: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  mediaId: string | null;
  mediaIds: string[];
  videoUrls: string[];
};

type ProviderFailure = Error & { permanent?: boolean; code?: string };

const youtubeThumbnail = (url: unknown) => {
  if (typeof url !== 'string') return undefined;
  const id = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?&/]+)/,
  )?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
};

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(FIREBASE_APP) private readonly firebaseApp: App | null,
    private readonly tokenCrypto: PushTokenCrypto,
    private readonly storage: StorageService,
  ) {}

  async processBatch(limit = 100) {
    const now = new Date();
    await primaryDb
      .update(notificationDeliveries)
      .set({ status: 'skipped', leaseUntil: null, updatedAt: now })
      .where(
        and(
          inArray(notificationDeliveries.status, ['pending', 'sending']),
          inArray(
            notificationDeliveries.pushDeviceId,
            primaryDb
              .select({ id: pushDevices.id })
              .from(pushDevices)
              .where(
                or(
                  isNotNull(pushDevices.revokedAt),
                  isNull(pushDevices.tokenCiphertext),
                ),
              ),
          ),
        ),
      );
    const claimed = await this.claim(limit);
    let sent = 0;
    let failed = 0;
    for (const delivery of claimed) {
      try {
        const token = this.tokenCrypto.decrypt(delivery.tokenCiphertext);
        await this.send(delivery, token);
        await primaryDb
          .update(notificationDeliveries)
          .set({
            status: 'sent',
            sentAt: new Date(),
            leaseUntil: null,
            lastErrorCode: null,
            updatedAt: new Date(),
          })
          .where(eq(notificationDeliveries.id, delivery.id));
        sent += 1;
      } catch (cause) {
        const error = this.normalizeFailure(cause);
        const permanent = error.permanent || delivery.attempts >= MAX_ATTEMPTS;
        await primaryDb.transaction(async (tx) => {
          await tx
            .update(notificationDeliveries)
            .set({
              status: permanent ? 'failed' : 'pending',
              leaseUntil: null,
              nextAttemptAt: permanent
                ? new Date()
                : new Date(
                    Date.now() +
                      RETRY_DELAYS_MS[
                        Math.min(
                          delivery.attempts - 1,
                          RETRY_DELAYS_MS.length - 1,
                        )
                      ],
                  ),
              lastErrorCode: error.code ?? 'provider_error',
              updatedAt: new Date(),
            })
            .where(eq(notificationDeliveries.id, delivery.id));
          if (error.permanent) {
            await tx
              .update(pushDevices)
              .set({
                tokenHash: null,
                tokenCiphertext: null,
                revokedAt: new Date(),
                tokenUpdatedAt: new Date(),
              })
              .where(eq(pushDevices.id, delivery.pushDeviceId));
          }
        });
        this.logger.warn({
          event: 'push_delivery_failed',
          deliveryId: delivery.id,
          provider: delivery.provider,
          code: error.code ?? 'provider_error',
          permanent,
        });
        failed += 1;
      }
    }
    return { claimed: claimed.length, sent, failed };
  }

  private async claim(limit: number): Promise<ClaimedDelivery[]> {
    const now = new Date();
    await primaryDb
      .update(notificationDeliveries)
      .set({ status: 'skipped', leaseUntil: null, updatedAt: now })
      .where(
        and(
          inArray(notificationDeliveries.status, ['pending', 'sending']),
          inArray(
            notificationDeliveries.notificationId,
            primaryDb
              .select({ id: notifications.id })
              .from(notifications)
              .where(
                and(
                  isNotNull(notifications.expiresAt),
                  lte(notifications.expiresAt, now),
                ),
              ),
          ),
        ),
      );

    return primaryDb.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: notificationDeliveries.id,
          pushDeviceId: notificationDeliveries.pushDeviceId,
          attempts: notificationDeliveries.attempts,
          provider: pushDevices.provider,
          tokenCiphertext: pushDevices.tokenCiphertext,
          notificationId: notifications.id,
          category: notifications.category,
          title: notifications.title,
          body: notifications.body,
          payload: notifications.payload,
          mediaId: notifications.mediaId,
          mediaIds: notifications.mediaIds,
          videoUrls: notifications.videoUrls,
        })
        .from(notificationDeliveries)
        .innerJoin(
          notifications,
          eq(notificationDeliveries.notificationId, notifications.id),
        )
        .innerJoin(
          pushDevices,
          eq(notificationDeliveries.pushDeviceId, pushDevices.id),
        )
        .where(
          and(
            or(
              and(
                eq(notificationDeliveries.status, 'pending'),
                lte(notificationDeliveries.nextAttemptAt, now),
              ),
              and(
                eq(notificationDeliveries.status, 'sending'),
                lte(notificationDeliveries.leaseUntil, now),
              ),
            ),
            lte(notifications.scheduledAt, now),
            or(
              isNull(notifications.expiresAt),
              gt(notifications.expiresAt, now),
            ),
            isNull(pushDevices.revokedAt),
            isNotNull(pushDevices.tokenCiphertext),
          ),
        )
        .orderBy(asc(notificationDeliveries.nextAttemptAt))
        .limit(Math.max(1, Math.min(limit, 500)))
        .for('update', { skipLocked: true });

      if (!rows.length) return [];
      const leaseUntil = new Date(Date.now() + 60_000);
      await tx
        .update(notificationDeliveries)
        .set({
          status: 'sending',
          attempts: sql`${notificationDeliveries.attempts} + 1`,
          leaseUntil,
          updatedAt: now,
        })
        .where(
          inArray(
            notificationDeliveries.id,
            rows.map((row) => row.id),
          ),
        );
      return rows.map((row) => ({
        ...row,
        attempts: row.attempts + 1,
        tokenCiphertext: row.tokenCiphertext!,
      }));
    });
  }

  private async send(delivery: ClaimedDelivery, token: string) {
    const mediaIds = delivery.mediaIds?.length
      ? delivery.mediaIds
      : delivery.mediaId
        ? [delivery.mediaId]
        : [];
    const [media] = mediaIds.length
      ? await primaryDb
          .select({ key: notificationMedia.objectKey })
          .from(notificationMedia)
          .where(eq(notificationMedia.id, mediaIds[0]))
          .limit(1)
      : [];
    const storedImageUrl = await this.storage.getUrl(media?.key);
    const imageUrl =
      storedImageUrl ??
      (typeof delivery.payload.imageUrl === 'string'
        ? delivery.payload.imageUrl
        : youtubeThumbnail(
            delivery.videoUrls?.[0] ?? delivery.payload.videoUrl,
          ));
    const actionUrl =
      typeof delivery.payload.actionUrl === 'string'
        ? delivery.payload.actionUrl
        : (delivery.videoUrls?.[0] ??
          (typeof delivery.payload.videoUrl === 'string'
            ? delivery.payload.videoUrl
            : undefined));
    const data = {
      notificationId: delivery.notificationId,
      category: delivery.category,
      payload: JSON.stringify(delivery.payload ?? {}),
      screen: 'Notifications',
      ...(actionUrl ? { actionUrl } : {}),
    };
    if (delivery.provider === 'fcm') {
      if (!this.firebaseApp) throw new Error('Firebase is not configured');
      const webAppUrl = process.env.FRONTEND_URL;
      const webLink =
        actionUrl ??
        (webAppUrl?.startsWith('https://')
          ? new URL('/notifications', webAppUrl).toString()
          : undefined);
      await getMessaging(this.firebaseApp).send({
        token,
        notification: {
          title: delivery.title,
          body: delivery.body,
          ...(imageUrl ? { imageUrl } : {}),
        },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'default',
            icon: 'notification_icon',
            sound: 'default',
            ...(imageUrl ? { imageUrl } : {}),
          },
        },
        webpush: {
          notification: {
            icon: '/favicon.png',
            ...(imageUrl ? { image: imageUrl } : {}),
          },
          ...(webLink ? { fcmOptions: { link: webLink } } : {}),
        },
      });
      return;
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        title: delivery.title,
        body: delivery.body,
        data,
        sound: 'default',
        channelId: 'default',
        ...(imageUrl ? { richContent: { image: imageUrl } } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
    const ticket = (await response.json()) as {
      data?: {
        status?: string;
        details?: { error?: string };
        message?: string;
      };
    };
    if (ticket.data?.status === 'error') {
      const error = new Error(
        ticket.data.message ?? 'Expo push failed',
      ) as ProviderFailure;
      error.code = ticket.data.details?.error ?? 'expo_error';
      error.permanent = error.code === 'DeviceNotRegistered';
      throw error;
    }
  }

  private normalizeFailure(cause: unknown): ProviderFailure {
    const error: ProviderFailure =
      cause instanceof Error ? cause : new Error(String(cause));
    const firebaseCode = (cause as { code?: string })?.code;
    if (firebaseCode) error.code = firebaseCode;
    if (
      firebaseCode === 'messaging/registration-token-not-registered' ||
      firebaseCode === 'messaging/invalid-registration-token' ||
      firebaseCode === 'messaging/mismatched-credential'
    ) {
      error.permanent = true;
    }
    return error;
  }
}
