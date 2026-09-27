import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, type Producer } from 'kafkajs';
import {
  envelopeFrom,
  eventKey,
  topicFor,
} from '../../packages/event-contracts/events';
import { MetricsService } from '../metrics/metrics.service';
import {
  OutboxService,
  DEFAULT_OUTBOX_BATCH_SIZE,
  type ClaimedOutboxEvent,
} from '../outbox/outbox.service';

@Injectable()
export class RelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RelayService.name);
  private readonly brokers =
    process.env.KAFKA_BROKERS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  private readonly interval = Number(process.env.RELAY_POLL_INTERVAL_MS ?? 500);
  private producer?: Producer;
  private running = false;
  private loop?: Promise<void>;
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
    }).producer({ idempotent: true, maxInFlightRequests: 5 });
    this.running = true;
    this.loop = this.run();
  }

  private async run() {
    let connected = false;
    while (this.running) {
      try {
        if (!connected) {
          await this.producer!.connect();
          connected = true;
        }
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
      if (this.running)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.interval);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
    }
  }

  private async publish(event: ClaimedOutboxEvent, deadLetter: boolean) {
    const envelope = envelopeFrom(event);
    await this.producer!.send({
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
            ...(deadLetter
              ? { 'last-error': event.lastError ?? 'unknown' }
              : {}),
          },
        },
      ],
    });
  }

  async onModuleDestroy() {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.producer?.disconnect();
  }
}
