import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTracing } from '../../../../packages/tracing/tracing';

/**
 * Flushes and shuts down the OpenTelemetry SDK as the very last step of a
 * graceful shutdown, mirroring `src/tracing/tracing-shutdown.hook.ts` (the
 * main API's/relay's hook). `onApplicationShutdown` runs after every other
 * provider's `onModuleDestroy`/`beforeApplicationShutdown` hook, in
 * particular `KafkaConsumerService.beforeApplicationShutdown` (leaves the
 * consumer group) and `DeadLetterProducer.onApplicationShutdown`
 * (disconnects the DLQ producer), so any span created while those tear down
 * is still exported before the SDK's exporter is closed. `initTracing`
 * deliberately does not register its own SIGTERM/SIGINT handlers; this hook
 * (registered by `TracingShutdownModule` in `AppModule`) is what actually
 * calls `shutdownTracing` for this process. See docs/diploma/tracing.md.
 */
@Injectable()
export class TracingShutdownHook implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
