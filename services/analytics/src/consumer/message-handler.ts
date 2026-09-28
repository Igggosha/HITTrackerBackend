import { Inject, Injectable, Logger } from '@nestjs/common';
import { eventContext } from '../common/log-context';
import { EventValidator } from '../events/event-validator';
import { MetricsService } from '../metrics/metrics.service';
import {
  InvalidEventError,
  Projector,
  type ApplyResult,
} from '../projections/projector';
import { describeError, isTransientError, ShutdownError } from './errors';

export const DLQ_TOPIC = 'hit.events.dlq';
export const CONSUMER_GROUP = 'analytics';

type HeaderValue = Buffer | string | (Buffer | string)[] | undefined;

/** The broker-independent shape of one consumed message. */
export type IncomingMessage = {
  topic: string;
  partition: number;
  offset: string;
  key: Buffer | string | null;
  value: Buffer | string | null;
  headers?: Record<string, HeaderValue>;
};

export type DeadLetter = {
  key: Buffer | string | null;
  value: Buffer | string | null;
  headers: Record<string, string>;
};

export type DeadLetterPublisher = (message: DeadLetter) => Promise<void>;
export const DEAD_LETTER_PUBLISHER = Symbol('DEAD_LETTER_PUBLISHER');

export type HandlerConfig = {
  /** Attempts for a permanent (non-transient) failure before the DLQ. */
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};
export const HANDLER_CONFIG = Symbol('HANDLER_CONFIG');

export type HandleOutcome = ApplyResult | 'skipped_unknown' | 'dead_lettered';

export function headerValue(
  headers: Record<string, HeaderValue> | undefined,
  name: string,
): string | undefined {
  const raw = headers?.[name];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first === undefined ? undefined : first.toString();
}

/**
 * Handles ONE Kafka message end to end: parse -> JSON Schema validation ->
 * idempotent projection in one DB transaction -> (on permanent failure)
 * dead-letter. It resolves only when the message's effect is durable (DB
 * committed, or DLQ accepted, or deliberately skipped); the caller then
 * commits the Kafka offset. It never resolves for a message that still has
 * to be retried, so an offset is never committed ahead of its effect.
 *
 * Tracing hook: `message.headers` are passed in whole, so extracting the
 * W3C `traceparent` header (added by the relay) and wrapping `handle` in a
 * CONSUMER span is a change local to this method.
 */
@Injectable()
export class MessageHandler {
  private readonly logger = new Logger('AnalyticsConsumer');
  private stopping = false;

  constructor(
    private readonly validator: EventValidator,
    private readonly projector: Projector,
    private readonly metrics: MetricsService,
    @Inject(DEAD_LETTER_PUBLISHER)
    private readonly publishDeadLetter: DeadLetterPublisher,
    @Inject(HANDLER_CONFIG) private readonly config: HandlerConfig,
  ) {}

  stop() {
    this.stopping = true;
  }

  handle(
    message: IncomingMessage,
    heartbeat: () => Promise<void> = () => Promise.resolve(),
  ): Promise<HandleOutcome> {
    const context = {
      eventId: headerValue(message.headers, 'event-id') ?? 'unknown',
      eventType: headerValue(message.headers, 'event-type') ?? 'unknown',
    };
    return eventContext.run(context, () =>
      this.process(message, heartbeat, context),
    );
  }

  private async process(
    message: IncomingMessage,
    heartbeat: () => Promise<void>,
    context: { eventId: string; eventType: string },
  ): Promise<HandleOutcome> {
    const source = {
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    };
    const startedAt = process.hrtime.bigint();
    const finish = (outcome: HandleOutcome) => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.eventsProcessed.inc({
        type: context.eventType,
        result: outcome,
      });
      this.metrics.processingSeconds.observe(
        { type: context.eventType },
        seconds,
      );
      this.logger.log({
        msg: 'event handled',
        result: outcome,
        ...source,
        durationMs: Math.round(seconds * 1000),
      });
      return outcome;
    };

    let permanentAttempts = 0;
    let transientAttempts = 0;
    for (;;) {
      try {
        const parsed = this.parse(message);
        // Best effort for logs/metrics when the relay's headers are missing.
        const { id, type } = (parsed ?? {}) as { id?: unknown; type?: unknown };
        if (context.eventId === 'unknown' && typeof id === 'string')
          context.eventId = id.slice(0, 64);
        if (context.eventType === 'unknown' && typeof type === 'string')
          context.eventType = type.slice(0, 64);
        const validation = this.validator.validate(parsed);
        if (validation.kind === 'unknown') {
          context.eventType = validation.type;
          this.logger.warn({
            msg: 'unknown event type/version skipped',
            version: validation.version,
            ...source,
          });
          return finish('skipped_unknown');
        }
        if (validation.kind === 'invalid')
          throw new InvalidEventError(
            `schema validation failed: ${validation.error}`,
          );
        context.eventId = validation.envelope.id;
        context.eventType = validation.envelope.type;
        return finish(await this.projector.apply(validation.envelope, source));
      } catch (error) {
        if (this.stopping || error instanceof ShutdownError) throw error;
        const transient = isTransientError(error);
        if (transient) transientAttempts++;
        else permanentAttempts++;
        if (transient || permanentAttempts < this.config.maxAttempts) {
          this.metrics.eventsProcessed.inc({
            type: context.eventType,
            result: 'retry',
          });
          this.logger.warn({
            msg: 'event processing failed, will retry',
            transient,
            attempt: transient ? transientAttempts : permanentAttempts,
            error: describeError(error),
            ...source,
          });
          await this.backoff(
            transient ? transientAttempts : permanentAttempts,
            heartbeat,
          );
          continue;
        }
        await this.deadLetter(message, error, permanentAttempts, heartbeat);
        return finish('dead_lettered');
      }
    }
  }

  private parse(message: IncomingMessage): unknown {
    if (message.value === null)
      throw new InvalidEventError('message has no value');
    try {
      return JSON.parse(message.value.toString()) as unknown;
    } catch {
      // The native message can quote the body; never echo it.
      throw new InvalidEventError('message value is not valid JSON');
    }
  }

  private async deadLetter(
    message: IncomingMessage,
    error: unknown,
    attempts: number,
    heartbeat: () => Promise<void>,
  ) {
    const reason =
      error instanceof InvalidEventError ? 'invalid' : 'processing_failed';
    const headers: Record<string, string> = {};
    for (const name of Object.keys(message.headers ?? {})) {
      const value = headerValue(message.headers, name);
      if (value !== undefined) headers[name] = value;
    }
    Object.assign(headers, {
      'dlq-reason': reason,
      'dlq-error': describeError(error),
      'dlq-attempts': String(attempts),
      'dlq-consumer-group': CONSUMER_GROUP,
      'dlq-source-topic': message.topic,
      'dlq-source-partition': String(message.partition),
      'dlq-source-offset': message.offset,
      'dlq-failed-at': new Date().toISOString(),
    });
    // The DLQ send itself is retried like any transient failure: the offset
    // must not be committed until the broker has accepted the dead letter.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.publishDeadLetter({
          key: message.key,
          value: message.value,
          headers,
        });
        break;
      } catch (dlqError) {
        if (this.stopping) throw dlqError;
        this.logger.error({
          msg: 'dead-letter publish failed, will retry',
          attempt,
          error: describeError(dlqError),
        });
        await this.backoff(attempt, heartbeat);
      }
    }
    this.metrics.deadLettered.inc({ reason });
    this.logger.error({
      msg: 'event sent to dead-letter topic',
      reason,
      error: headers['dlq-error'],
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
    });
  }

  /**
   * Exponential backoff that keeps the group membership alive: the wait is
   * sliced so `heartbeat()` runs at least every 3s (sessionTimeout is 30s).
   */
  private async backoff(attempt: number, heartbeat: () => Promise<void>) {
    let remaining = Math.min(
      this.config.retryMaxMs,
      this.config.retryBaseMs * 2 ** Math.min(attempt - 1, 20),
    );
    while (remaining > 0) {
      if (this.stopping) throw new ShutdownError();
      const slice = Math.min(remaining, 3_000);
      await new Promise((resolve) => setTimeout(resolve, slice));
      remaining -= slice;
      await heartbeat();
    }
  }
}
