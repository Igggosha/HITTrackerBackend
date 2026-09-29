import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import {
  Kafka,
  Partitioners,
  type Admin,
  type Consumer,
  type Producer,
} from 'kafkajs';
import { SearchEventValidator } from './event-validator';
import { IndexWriterService } from './index-writer.service';
import { MetricsService } from '../metrics/metrics.service';

const topics = ['hit.catalog.v1', 'hit.user.v1'] as const;
const groupId = 'catalog-search-v1';

@Injectable()
export class SearchIndexerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SearchIndexerService.name);
  private readonly validator = new SearchEventValidator();
  private readonly kafka: Kafka;
  private consumer?: Consumer;
  private producer?: Producer;
  private admin?: Admin;
  private lagTimer?: NodeJS.Timeout;

  constructor(
    private readonly writer: IndexWriterService,
    private readonly metrics: MetricsService,
  ) {
    const brokers = process.env.KAFKA_BROKERS?.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!brokers?.length)
      throw new Error('KAFKA_BROKERS is required for search indexer');
    this.kafka = new Kafka({ clientId: 'hit-search-indexer', brokers });
  }

  async onModuleInit() {
    this.consumer = this.kafka.consumer({ groupId });
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    await Promise.all([this.consumer.connect(), this.producer.connect()]);
    for (const topic of topics)
      await this.consumer.subscribe({ topic, fromBeginning: true });
    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: 1,
      eachMessage: async (payload) => {
        const { topic, partition, message } = payload;
        const raw = this.parse(message.value);
        const envelope = this.validator.validate(raw);
        if (!envelope) {
          await this.deadLetter(
            topic,
            partition,
            message.offset,
            message.key,
            message.value,
            'invalid',
          );
          this.metrics.searchIndexerDlq.inc({ reason: 'invalid' });
        } else {
          await this.applyWithRetry(envelope, () => payload.heartbeat(), {
            topic,
            partition,
            offset: message.offset,
            key: message.key,
            value: message.value,
          });
        }
        await this.consumer!.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);
      },
    });
    this.lagTimer = setInterval(
      () => void Promise.all([this.updateLag(), this.updateHealth()]),
      15_000,
    );
    await this.updateHealth();
  }

  private parse(value: Buffer | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value.toString()) as unknown;
    } catch {
      return null;
    }
  }

  private async applyWithRetry(
    envelope: Parameters<IndexWriterService['apply']>[0],
    heartbeat: () => Promise<void>,
    source: {
      topic: string;
      partition: number;
      offset: string;
      key: Buffer | null;
      value: Buffer | null;
    },
  ) {
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.writer.apply(envelope);
        this.metrics.searchIndexerEvents.inc({ type: envelope.type, result });
        await this.updateHealth();
        return;
      } catch {
        this.metrics.searchIndexerRetries.inc({ type: envelope.type });
        if (attempt >= Number(process.env.SEARCH_INDEXER_MAX_ATTEMPTS ?? 5)) {
          await this.deadLetter(
            source.topic,
            source.partition,
            source.offset,
            source.key,
            source.value,
            'processing_failed',
          );
          this.metrics.searchIndexerDlq.inc({ reason: 'processing_failed' });
          this.logger.error({
            msg: 'search event dead-lettered',
            eventId: envelope.id,
            eventType: envelope.type,
          });
          return;
        }
        this.logger.warn({
          msg: 'search event retry',
          eventId: envelope.id,
          eventType: envelope.type,
          attempt,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(5_000, 250 * 2 ** (attempt - 1))),
        );
        await heartbeat();
      }
    }
  }

  private async deadLetter(
    topic: string,
    partition: number,
    offset: string,
    key: Buffer | null,
    value: Buffer | null,
    reason: string,
  ) {
    await this.producer!.send({
      topic: 'hit.events.dlq',
      acks: -1,
      messages: [
        {
          key,
          value,
          headers: {
            'dlq-reason': reason,
            'dlq-consumer-group': groupId,
            'dlq-source-topic': topic,
            'dlq-source-partition': String(partition),
            'dlq-source-offset': offset,
          },
        },
      ],
    });
  }

  private async updateLag() {
    try {
      this.admin ??= this.kafka.admin();
      await this.admin.connect().catch(() => undefined);
      const committed = await this.admin.fetchOffsets({
        groupId,
        topics: [...topics],
      });
      for (const topic of topics) {
        const end = await this.admin.fetchTopicOffsets(topic);
        const current = committed.find((entry) => entry.topic === topic);
        for (const item of end) {
          const offset = current?.partitions.find(
            (part) => part.partition === item.partition,
          )?.offset;
          const lag =
            offset && offset !== '-1'
              ? Math.max(0, Number(BigInt(item.offset) - BigInt(offset)))
              : Number(item.offset);
          this.metrics.searchIndexerLag.set(
            { topic, partition: String(item.partition) },
            lag,
          );
        }
      }
    } catch {
      await this.admin?.disconnect().catch(() => undefined);
      this.admin = undefined;
    }
  }

  private async updateHealth() {
    try {
      const health = await this.writer.health();
      this.metrics.searchElasticsearchHealthy.set(health.healthy ? 1 : 0);
      this.metrics.searchDocuments.set(
        { section: 'programs' },
        health.programs,
      );
      this.metrics.searchDocuments.set(
        { section: 'exercises' },
        health.exercises,
      );
    } catch {
      this.metrics.searchElasticsearchHealthy.set(0);
    }
  }

  async onApplicationShutdown() {
    if (this.lagTimer) clearInterval(this.lagTimer);
    await this.consumer?.disconnect().catch(() => undefined);
    await this.producer?.disconnect().catch(() => undefined);
    await this.admin?.disconnect().catch(() => undefined);
  }
}
