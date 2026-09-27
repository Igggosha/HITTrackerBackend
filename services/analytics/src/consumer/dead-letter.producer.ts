import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Partitioners, type Kafka, type Producer } from 'kafkajs';
import { KAFKA } from './kafka-consumer.service';
import { DLQ_TOPIC, type DeadLetter } from './message-handler';

/** Publishes dead letters to hit.events.dlq (connects lazily, acks=all, same key as the source). */
@Injectable()
export class DeadLetterProducer implements OnApplicationShutdown {
  private producer?: Producer;
  private connecting?: Promise<void>;

  constructor(@Inject(KAFKA) private readonly kafka: Kafka | null) {}

  async publish(message: DeadLetter): Promise<void> {
    if (!this.kafka) throw new Error('Kafka is not configured');
    if (!this.producer) {
      // At-least-once like every other hop: a duplicate dead letter is
      // harmless (same event id), a lost one is not.
      const producer = this.kafka.producer({
        createPartitioner: Partitioners.DefaultPartitioner,
      });
      this.connecting ??= producer.connect().then(() => {
        this.producer = producer;
      });
      try {
        await this.connecting;
      } finally {
        this.connecting = undefined;
      }
    }
    await this.producer!.send({
      topic: DLQ_TOPIC,
      acks: -1,
      messages: [message],
    });
  }

  async onApplicationShutdown() {
    await this.producer?.disconnect().catch(() => undefined);
  }
}
