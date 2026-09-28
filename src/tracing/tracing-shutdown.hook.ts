import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTracing } from '../../packages/tracing/tracing';

/**
 * Flushes and shuts down the OpenTelemetry SDK as the very last step of a
 * graceful shutdown. `onApplicationShutdown` runs after every provider's
 * `onModuleDestroy`/`beforeApplicationShutdown` hook, so spans created while
 * OTHER providers tear down (e.g. `RelayService.onModuleDestroy` flushing a
 * final Kafka publish, which opens a producer span) are still exported
 * before the SDK's exporter is closed. `initTracing` deliberately no longer
 * registers its own SIGTERM/SIGINT handlers, so this hook (registered by
 * `TracingShutdownModule` in both `AppModule` and `RelayModule`) is what
 * actually calls `shutdownTracing` for both the API and the standalone relay
 * process. See docs/diploma/tracing.md.
 */
@Injectable()
export class TracingShutdownHook implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
