import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type LogEntry,
} from 'kafkajs';
import { MetricsService } from '../metrics/metrics.service';
import { describeError } from './errors';
import { CONSUMER_GROUP, MessageHandler } from './message-handler';

export const SOURCE_TOPICS = ['hit.workout.v1', 'hit.user.v1'] as const;
export const KAFKA = Symbol('KAFKA');

const LAG_INTERVAL_MS = 15_000;
const MAX_RESTART_DELAY_MS = 30_000;

/** Routes kafkajs' own logs through Nest/pino so they share the JSON format. */
function kafkaLogCreator() {
  const logger = new Logger('kafkajs');
  return ({ level, log }: LogEntry) => {
    const { message, ...fields } = log;
    const entry = { msg: message, ...fields };
    if (level === logLevel.ERROR) logger.error(entry);
    else if (level === logLevel.WARN) logger.warn(entry);
    else logger.log(entry);
  };
}

/**
 * Lag of one partition. A group without a commit (`-1`) or one just reset to
 * earliest (`-2`) will start at the low watermark, so that is what counts.
 */
export function partitionLag(
  watermarks: { high: string; low: string },
  committed: string | undefined,
): number {
  const from =
    committed === undefined || BigInt(committed) < 0n
      ? BigInt(watermarks.low)
      : BigInt(committed);
  return Math.max(0, Number(BigInt(watermarks.high) - from));
}

export function createKafka(brokers: string[]): Kafka {
  return new Kafka({
    clientId: 'hit-analytics',
    brokers,
    connectionTimeout: 5_000,
    requestTimeout: 10_000,
    logLevel: logLevel.WARN,
    logCreator: kafkaLogCreator,
    retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 10_000 },
  });
}

/**
 * Consumer group `analytics` on hit.workout.v1 + hit.user.v1.
 *
 * - `autoCommit: false`: the offset of a message is committed explicitly,
 *   only after `MessageHandler.handle` resolved, i.e. after the projection's
 *   DB transaction committed (or the message was dead-lettered/skipped).
 *   A crash in between re-delivers the message; `processed_events` turns
 *   that second delivery into a no-op.
 * - Starting is non-blocking with capped exponential backoff: the HTTP read
 *   API keeps serving the (possibly stale) read models while Kafka is down.
 */
@Injectable()
export class KafkaConsumerService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('AnalyticsConsumer');
  private consumer?: Consumer;
  private admin?: Admin;
  private running = false;
  private restartDelayMs = 1_000;
  private lagTimer?: NodeJS.Timeout;
  private startLoop?: Promise<void>;
  private wakeStartLoop?: () => void;

  constructor(
    @Inject(KAFKA) private readonly kafka: Kafka | null,
    private readonly handler: MessageHandler,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.kafka) {
      this.logger.warn(
        'KAFKA_BROKERS unset: consumer disabled (read API only)',
      );
      return;
    }
    this.running = true;
    this.startLoop = this.startWithBackoff();
    this.lagTimer = setInterval(() => void this.updateLag(), LAG_INTERVAL_MS);
    this.lagTimer.unref();
  }

  private async startWithBackoff() {
    while (this.running) {
      try {
        await this.start();
        this.restartDelayMs = 1_000;
        return;
      } catch (error) {
        this.logger.error({
          msg: 'Kafka consumer failed to start, retrying',
          delayMs: this.restartDelayMs,
          error: describeError(error),
        });
        await this.consumer?.disconnect().catch(() => undefined);
        this.consumer = undefined;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.restartDelayMs);
          this.wakeStartLoop = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        this.restartDelayMs = Math.min(
          this.restartDelayMs * 2,
          MAX_RESTART_DELAY_MS,
        );
      }
    }
  }

  private async start() {
    // After a non-restartable crash the old instance is already stopped;
    // disconnecting it again is harmless and releases its sockets.
    await this.consumer?.disconnect().catch(() => undefined);
    const consumer = this.kafka!.consumer({
      groupId: CONSUMER_GROUP,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      retry: { retries: 8, initialRetryTime: 500, maxRetryTime: 30_000 },
    });
    this.consumer = consumer;
    // kafkajs restarts itself after retriable errors; a crash it will not
    // restart from (restart === false) goes through our own backoff loop.
    consumer.on(consumer.events.CRASH, (event) => {
      this.logger.error({
        msg: 'Kafka consumer crashed',
        restart: event.payload.restart,
        error: describeError(event.payload.error),
      });
      if (!event.payload.restart && this.running && this.consumer === consumer)
        this.startLoop = this.startWithBackoff();
    });
    consumer.on(consumer.events.GROUP_JOIN, (event) =>
      this.logger.log({
        msg: 'joined consumer group',
        groupId: event.payload.groupId,
        memberAssignment: event.payload.memberAssignment,
      }),
    );

    await consumer.connect();
    await consumer.subscribe({
      topics: [...SOURCE_TOPICS],
      fromBeginning: true,
    });
    await consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async (payload) => {
        const { topic, partition, message } = payload;
        await this.handler.handle(
          {
            topic,
            partition,
            offset: message.offset,
            key: message.key,
            value: message.value,
            headers: message.headers,
          },
          () => payload.heartbeat(),
        );
        // Only reached once the effect is durable (see MessageHandler).
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);
      },
    });
    this.logger.log({ msg: 'Kafka consumer running', topics: SOURCE_TOPICS });
  }

  /** analytics_consumer_lag{topic,partition} = high watermark - committed offset. */
  private async updateLag() {
    try {
      if (!this.admin) {
        this.admin = this.kafka!.admin();
        await this.admin.connect();
      }
      const committed = await this.admin.fetchOffsets({
        groupId: CONSUMER_GROUP,
        topics: [...SOURCE_TOPICS],
      });
      for (const topic of SOURCE_TOPICS) {
        const ends = await this.admin.fetchTopicOffsets(topic);
        const group = committed.find((entry) => entry.topic === topic);
        for (const end of ends) {
          const offset = group?.partitions.find(
            (p) => p.partition === end.partition,
          )?.offset;
          this.metrics.consumerLag.set(
            { topic, partition: String(end.partition) },
            partitionLag(end, offset),
          );
        }
      }
    } catch (error) {
      this.logger.warn({
        msg: 'consumer lag update failed',
        error: describeError(error),
      });
      await this.admin?.disconnect().catch(() => undefined);
      this.admin = undefined;
    }
  }

  /**
   * Graceful shutdown: stop retry loops, let kafkajs finish the in-flight
   * message (its offset is committed only if its transaction committed),
   * then leave the group so partitions are reassigned immediately. Runs in
   * `beforeApplicationShutdown`, i.e. before the PostgreSQL pool closes.
   */
  async beforeApplicationShutdown(signal?: string) {
    if (!this.kafka) return;
    this.logger.log({ msg: 'consumer shutting down', signal });
    this.running = false;
    this.handler.stop();
    this.wakeStartLoop?.();
    if (this.lagTimer) clearInterval(this.lagTimer);
    await this.consumer?.disconnect().catch(() => undefined);
    await this.startLoop?.catch(() => undefined);
    await this.admin?.disconnect().catch(() => undefined);
    this.logger.log({ msg: 'consumer stopped and left the group' });
  }
}
