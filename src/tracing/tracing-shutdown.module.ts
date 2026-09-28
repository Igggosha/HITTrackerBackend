import { Module } from '@nestjs/common';
import { TracingShutdownHook } from './tracing-shutdown.hook';

/**
 * Imported by both `AppModule` (API) and `RelayModule` (standalone relay) so
 * `shutdownTracing()` runs, via `onApplicationShutdown`, in both processes'
 * shutdown sequence. See `tracing-shutdown.hook.ts`.
 */
@Module({ providers: [TracingShutdownHook] })
export class TracingShutdownModule {}
