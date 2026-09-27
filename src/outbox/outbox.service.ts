import { Injectable } from '@nestjs/common';
import { and, asc, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/db';
import { outboxEvents } from '../db/schema';
import {
  outboxEventDefinitions,
  type OutboxEvent,
  type OutboxEventType,
} from './events';
import type { DbTransaction } from './transaction';

export type ClaimedOutboxEvent = typeof outboxEvents.$inferSelect;

export type ClaimOptions = {
  /** Maximum number of events to lock in one batch. */
  limit?: number;
  /**
   * Events that already failed this many times are sent to the DLQ by the relay.
   */
  maxAttempts?: number;
};

export type BatchResult = {
  claimed: number;
  published: string[];
  failed: { id: string; error: string } | null;
};

export const DEFAULT_OUTBOX_BATCH_SIZE = 100;
export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 10;
const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class OutboxService {
  /**
   * Stores an event in the caller's transaction. The event commits or rolls
   * back together with the business change, so there is never an event for a
   * change that did not happen, nor a change whose event was lost.
   */
  async enqueue<T extends OutboxEventType>(
    tx: DbTransaction,
    event: OutboxEvent<T>,
  ): Promise<void> {
    if (!tx || typeof (tx as { rollback?: unknown }).rollback !== 'function') {
      // Type-checked already; this guards `as any` call sites at runtime.
      throw new Error('OutboxService.enqueue requires the caller transaction');
    }
    const definition = outboxEventDefinitions[event.type];
    await tx.insert(outboxEvents).values({
      aggregateType: definition.aggregateType,
      aggregateId: String(event.aggregateId),
      eventType: event.type,
      eventVersion: definition.version,
      payload: event.payload,
    });
  }

  /**
   * Locks the oldest unpublished events. `SKIP LOCKED` lets several relay
   * instances run side by side: each one gets a disjoint batch instead of
   * waiting for, or double-publishing, rows another relay holds.
   */
  async claimBatch(
    tx: DbTransaction,
    {
      limit = DEFAULT_OUTBOX_BATCH_SIZE,
      maxAttempts = DEFAULT_OUTBOX_MAX_ATTEMPTS,
    }: ClaimOptions = {},
  ): Promise<ClaimedOutboxEvent[]> {
    return tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.publishedAt),
          lt(outboxEvents.attempts, maxAttempts),
        ),
      )
      .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
      .limit(limit)
      .for('update', { skipLocked: true });
  }

  async markPublished(tx: DbTransaction, ids: readonly string[]) {
    if (!ids.length) return;
    await tx
      .update(outboxEvents)
      .set({ publishedAt: sql`now()`, lastError: null })
      .where(
        and(
          inArray(outboxEvents.id, [...ids]),
          isNull(outboxEvents.publishedAt),
        ),
      );
  }

  async recordFailure(tx: DbTransaction, id: string, error: unknown) {
    await tx
      .update(outboxEvents)
      .set({
        attempts: sql`${outboxEvents.attempts} + 1`,
        lastError: describeError(error),
      })
      .where(inArray(outboxEvents.id, [id]));
  }

  /**
   * One relay iteration: claim, publish in occurrence order, record the
   * outcome, commit. Delivery is at-least-once: if the commit fails after the
   * broker accepted an event, the event is published again, so consumers
   * de-duplicate by event id.
   *
   * Publishing stops at the first failure so later events of the same
   * aggregate never overtake an earlier one; the unattempted remainder stays
   * unpublished for the next iteration.
   */
  async processBatch(
    publish: (event: ClaimedOutboxEvent) => Promise<void>,
    options: ClaimOptions = {},
  ): Promise<BatchResult> {
    return db.transaction(async (tx) => {
      const events = await this.claimBatch(tx, options);
      const published: string[] = [];
      let failed: BatchResult['failed'] = null;

      for (const event of events) {
        try {
          await publish(event);
          published.push(event.id);
        } catch (error) {
          await this.recordFailure(tx, event.id, error);
          failed = { id: event.id, error: describeError(error) };
          break;
        }
      }

      await this.markPublished(tx, published);
      return { claimed: events.length, published, failed };
    });
  }

  /** Retry DLQ delivery until acknowledged; a failed DLQ send leaves the row intact. */
  async processDeadLetters(
    publish: (event: ClaimedOutboxEvent) => Promise<void>,
    {
      limit = DEFAULT_OUTBOX_BATCH_SIZE,
      maxAttempts = DEFAULT_OUTBOX_MAX_ATTEMPTS,
    }: ClaimOptions = {},
  ): Promise<BatchResult> {
    return db.transaction(async (tx) => {
      const events = await tx
        .select()
        .from(outboxEvents)
        .where(
          and(
            isNull(outboxEvents.publishedAt),
            gte(outboxEvents.attempts, maxAttempts),
          ),
        )
        .orderBy(asc(outboxEvents.occurredAt), asc(outboxEvents.id))
        .limit(limit)
        .for('update', { skipLocked: true });
      const published: string[] = [];
      let failed: BatchResult['failed'] = null;
      for (const event of events) {
        try {
          await publish(event);
          published.push(event.id);
        } catch (error) {
          failed = { id: event.id, error: describeError(error) };
          break;
        }
      }
      await this.markPublished(tx, published);
      return { claimed: events.length, published, failed };
    });
  }
}

function describeError(error: unknown) {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}
