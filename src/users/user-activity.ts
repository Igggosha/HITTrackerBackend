import { Logger } from '@nestjs/common';
import { db } from '../db/db';
import { userActivityEvents, type UserActivityMetadata } from '../db/schema';
import type { DbTransaction } from '../outbox/transaction';

export type AdminUserActivityItem = {
  id: string;
  type: string;
  category: 'account' | 'profile' | 'training' | 'programs' | 'access';
  occurredAt: Date;
  metadata: UserActivityMetadata;
  actorUserId?: number | null;
};

type UserActivityValues = {
  userId: number;
  actorUserId?: number | null;
  type: string;
  metadata?: UserActivityMetadata;
};

const logger = new Logger('UserActivity');

/**
 * Appends to the admin activity timeline.
 *
 * With a transaction the row is written inside it and errors propagate: the
 * activity entry commits or rolls back together with the change it describes
 * (and with that change's outbox event), so the timeline cannot show an edit
 * that never happened or miss one that did.
 *
 * Without a transaction there is no business write left to protect: the change
 * already committed on its own (for example after an object-storage call that
 * cannot join a database transaction). The timeline is operational context,
 * not a compliance ledger, so a logging outage there must not turn a
 * successful request into an error; the failure is logged and swallowed.
 */
export async function recordUserActivity(
  values: UserActivityValues,
  tx?: DbTransaction,
) {
  const row = { ...values, metadata: values.metadata ?? {} };
  if (tx) {
    await tx.insert(userActivityEvents).values(row);
    return;
  }
  try {
    await db.insert(userActivityEvents).values(row);
  } catch (error) {
    // Only the type is logged: metadata can hold personal profile values.
    logger.error(
      `Could not record user activity ${values.type}`,
      error instanceof Error ? error.stack : undefined,
    );
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
