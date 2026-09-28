import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';
import { Client } from 'pg';
import {
  envelopeFrom,
  eventKey,
  topicFor,
} from '../../packages/event-contracts/events';
import { MetricsService } from '../metrics/metrics.service';
import {
  activeTraceContext,
  producerSpan,
} from '../../packages/tracing/tracing';
import {
  OutboxService,
  DEFAULT_OUTBOX_BATCH_SIZE,
  type ClaimedOutboxEvent,
} from '../outbox/outbox.service';

// A grey-failing broker (accepts the TCP connection but never answers, or
// answers very slowly) must not be able to pin a `db.transaction` that holds
// `FOR UPDATE SKIP LOCKED` row locks and a pool connection for kafkajs's own
// retry budget (default: tens of seconds). Every knob below is tight and
// env-overridable so an operator can tune it without a code change, and
// `publishTimeoutMs` is enforced a second time with `Promise.race` in
// `publish()` so a hang that ignores kafkajs's own timeouts (e.g. stuck DNS)
// still turns into an ordinary publish failure within a bounded time.
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 5_000;

@Injectable()
export class RelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayService.name);
  private readonly brokers =
    process.env.KAFKA_BROKERS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  private readonly interval = Number(
    process.env.RELAY_FALLBACK_POLL_INTERVAL_MS ??
      process.env.RELAY_POLL_INTERVAL_MS ??
      5_000,
  );
  private readonly connectionTimeoutMs = Number(
    process.env.RELAY_CONNECTION_TIMEOUT_MS ?? DEFAULT_CONNECTION_TIMEOUT_MS,
  );
  private readonly publishTimeoutMs = Number(
    process.env.RELAY_PUBLISH_TIMEOUT_MS ?? DEFAULT_PUBLISH_TIMEOUT_MS,
  );
  private producer?: Producer;
  private running = false;
  private loop?: Promise<void>;
  private listenerLoop?: Promise<void>;
  private listener?: Client;
  private stopListening?: () => void;
  private pending = false;
  private wake?: () => void;

  constructor(
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    if (!this.brokers.length) {
      this.logger.log('Kafka relay disabled: KAFKA_BROKERS unset');
      return;
    }
    this.producer = new Kafka({
      clientId: 'hit-outbox-relay',
      brokers: this.brokers,
      connectionTimeout: this.connectionTimeoutMs,
      requestTimeout: this.publishTimeoutMs,
      // Small, bounded retry budget: this relay polls again on the next tick
      // anyway, so kafkajs does not need its own long backoff schedule.
      retry: {
        retries: 2,
        initialRetryTime: Math.min(300, this.publishTimeoutMs),
        maxRetryTime: this.publishTimeoutMs,
      },
    }).producer({ idempotent: true, maxInFlightRequests: 5 });
    this.running = true;
    this.metrics.outboxListenerConnected.set(0);
    this.listenerLoop = this.listen();
    this.loop = this.run();
  }

  private notify() {
    if (!this.running || this.pending) return;
    this.pending = true;
    this.metrics.outboxRelayWakeups.inc({ reason: 'notify' });
    this.wake?.();
  }

  private async listen() {
    let backoff = 250;
    while (this.running) {
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: this.connectionTimeoutMs,
      });
      this.listener = client;
      try {
        const lost = new Promise<void>((resolve) => {
          client.on('error', () => resolve());
          client.once('end', resolve);
          this.stopListening = resolve;
        });
        await client.connect();
        if (!this.running) break;
        client.on('notification', (message) => {
          if (message.channel === 'outbox_events') this.notify();
        });
        await client.query('LISTEN outbox_events');
        if (!this.running) break;
        this.metrics.outboxListenerConnected.set(1);
        // A healthy connection restarts the reconnect schedule from the minimum.
        backoff = 250;
        await lost;
      } catch (error) {
        if (this.running)
          this.logger.warn(
            `outbox listener error: ${error instanceof Error ? error.name : 'unknown'}`,
          );
      } finally {
        this.metrics.outboxListenerConnected.set(0);
        this.stopListening = undefined;
        this.listener = undefined;
        await client.end().catch(() => undefined);
        client.removeAllListeners();
      }
      if (!this.running) break;
      this.logger.warn(
        `outbox listener disconnected; retrying in ${backoff}ms`,
      );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoff);
        this.stopListening = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.stopListening = undefined;
      backoff = Math.min(backoff * 2, 5_000);
    }
  }

  private async run() {
    let connected = false;
    while (this.running) {
      try {
        if (!connected) {
          await this.producer!.connect();
          connected = true;
        }
        // The DLQ is drained first and gates the normal batch: an event must
        // never overtake an earlier same-aggregate event that is still stuck
        // in dead-letter retries. The trade-off is that a stuck DLQ (e.g. the
        // `hit.events.dlq` topic itself is unreachable) stalls delivery for
        // every user, not just the one whose event dead-lettered - acceptable
        // at this scale, where the DLQ is expected to be rare and small.
        const dlq = await this.outbox.processDeadLetters((event) =>
          this.publish(event, true),
        );
        const batch = dlq.failed
          ? { claimed: 0, published: [], failed: null }
          : await this.outbox.processBatch((event) =>
              this.publish(event, false),
            );
        this.metrics.outboxPublished.inc(batch.published.length);
        this.metrics.outboxPublishFailures.inc(
          Number(!!batch.failed) + Number(!!dlq.failed),
        );
        if (batch.claimed || dlq.claimed)
          this.logger.log({
            event: 'outbox_batch',
            claimed: batch.claimed,
            published: batch.published.length,
            failed: Number(!!batch.failed),
            deadLettered: dlq.published.length,
            dlqFailed: Number(!!dlq.failed),
          });
        if (
          !batch.failed &&
          !dlq.failed &&
          (batch.claimed === DEFAULT_OUTBOX_BATCH_SIZE ||
            dlq.claimed === DEFAULT_OUTBOX_BATCH_SIZE)
        )
          continue;
      } catch (error) {
        this.metrics.outboxPublishFailures.inc();
        this.logger.error(
          `outbox relay error: ${error instanceof Error ? error.name : 'unknown'}`,
        );
        connected = false;
        try {
          await this.producer!.disconnect();
        } catch {
          /* retry next poll */
        }
      }
      if (!this.running) break;
      if (this.pending) {
        this.pending = false;
        continue;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.metrics.outboxRelayWakeups.inc({ reason: 'timer' });
          this.wake = undefined;
          resolve();
        }, this.interval);
        this.wake = () => {
          clearTimeout(timer);
          this.wake = undefined;
          resolve();
        };
      });
      this.pending = false;
    }
  }

  private async publish(event: ClaimedOutboxEvent, deadLetter: boolean) {
    const envelope = envelopeFrom(event);
    await producerSpan(
      `publish ${deadLetter ? 'hit.events.dlq' : topicFor(envelope.type)}`,
      event.traceContext,
      async () =>
        this.withTimeout(
          this.producer!.send({
            topic: deadLetter ? 'hit.events.dlq' : topicFor(envelope.type),
            acks: -1,
            messages: [
              {
                key: eventKey(envelope.payload),
                value: JSON.stringify(envelope),
                headers: {
                  'event-id': envelope.id,
                  'event-type': envelope.type,
                  'event-version': String(envelope.version),
                  'occurred-at': envelope.occurredAt,
                  ...activeTraceContext(),
                  ...(deadLetter
                    ? { 'last-error': event.lastError ?? 'unknown' }
                    : {}),
                },
              },
            ],
          }),
          this.publishTimeoutMs,
          `Kafka publish timed out after ${this.publishTimeoutMs}ms`,
        ),
    );
  }

  /**
   * A second, independent bound on top of kafkajs's own `requestTimeout`.
   * kafkajs's timeout only covers a request it has actually sent; a hang
   * earlier in the call (DNS, socket setup that outlives `connectionTimeout`
   * under some failure modes, an event-loop stall) would otherwise never
   * settle. `Promise.race` guarantees `publish()` always settles within
   * `ms`, turning any such hang into an ordinary rejection that the caller's
   * `recordFailure` path handles like any other broker error - it never lets
   * a wedged send hold the surrounding `db.transaction` open.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  async onModuleDestroy() {
    this.running = false;
    this.stopListening?.();
    await this.listener?.end().catch(() => undefined);
    this.wake?.();
    await this.listenerLoop;
    await this.loop;
    await this.producer?.disconnect();
  }
}
