// EN: Materializes weekly slots and their analytics events in the caller's transaction.
// UK: Створює щотижневі записи та аналітичні події в транзакції викликача.

import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { userProgramSchedule, userProgramScheduleSeries } from '../db/schema';
import { OutboxService } from '../outbox/outbox.service';
import type { DbTransaction } from '../outbox/transaction';
import { weeklyDatesInRange } from './schedule.utils';

export async function materializeWeeklyAssignments(
  tx: DbTransaction,
  outbox: OutboxService,
  userId: number,
  from: string | null,
  to: string,
) {
  // EN: The lock prevents a concurrent cancellation from removing a series before its slots are inserted.
  // UK: Блокування не дає паралельному скасуванню видалити серію до вставлення її записів.
  const series = await tx
    .select()
    .from(userProgramScheduleSeries)
    .where(
      and(
        eq(userProgramScheduleSeries.userId, userId),
        lte(userProgramScheduleSeries.startsOn, to),
        from
          ? or(
              isNull(userProgramScheduleSeries.endsOn),
              gte(userProgramScheduleSeries.endsOn, from),
            )
          : undefined,
      ),
    )
    .for('share');
  for (const item of series) {
    const dates = weeklyDatesInRange(
      item.startsOn,
      from ?? item.startsOn,
      item.endsOn && item.endsOn < to ? item.endsOn : to,
    );
    if (!dates.length) continue;
    const inserted = await tx
      .insert(userProgramSchedule)
      .values(
        dates.map((scheduledFor) => ({
          userId,
          programId: item.programId,
          scheduledFor,
          seriesId: item.id,
        })),
      )
      .onConflictDoNothing()
      .returning();
    for (const assignment of inserted) {
      await outbox.enqueue(tx, {
        type: 'program.scheduled',
        aggregateId: userId,
        payload: {
          userId,
          programId: assignment.programId,
          scheduledFor: assignment.scheduledFor,
          repeat: 'weekly',
          repeatUntil: null,
          seriesId: assignment.seriesId,
          scheduleIds: [assignment.id],
          assignments: [
            {
              scheduleId: assignment.id,
              scheduledFor: assignment.scheduledFor,
            },
          ],
        },
      });
    }
  }
}
