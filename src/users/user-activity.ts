import { db } from '../db/db';
import {
  userActivityEvents,
  type UserActivityMetadata,
} from '../db/schema';

export type AdminUserActivityItem = {
  id: string;
  type: string;
  category: 'account' | 'profile' | 'training' | 'programs' | 'access';
  occurredAt: Date;
  metadata: UserActivityMetadata;
  actorUserId?: number | null;
};

export async function recordUserActivity(values: {
  userId: number;
  actorUserId?: number | null;
  type: string;
  metadata?: UserActivityMetadata;
}) {
  try {
    await db.insert(userActivityEvents).values({
      ...values,
      metadata: values.metadata ?? {},
    });
  } catch (error) {
    // This timeline is operational context, not a compliance ledger. A logging
    // outage must not turn a successful profile or access change into an error.
    console.error('Could not record user activity', error);
  }
}

export function paginateUserActivity(
  sources: AdminUserActivityItem[][],
  page: number,
  limit: number,
) {
  const offset = (page - 1) * limit;
  const merged = sources.flat().sort((left, right) => {
    const byTime = right.occurredAt.getTime() - left.occurredAt.getTime();
    return byTime || right.id.localeCompare(left.id);
  });
  return {
    items: merged.slice(offset, offset + limit),
    page,
    limit,
    hasMore: merged.length > offset + limit,
  };
}
