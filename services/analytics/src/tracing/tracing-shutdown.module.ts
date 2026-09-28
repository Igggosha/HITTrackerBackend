import { Module } from '@nestjs/common';
import { TracingShutdownHook } from './tracing-shutdown.hook';

/**
 * Imported by `AppModule` so `shutdownTracing()` runs, via
 * `onApplicationShutdown`, as the last step of this process's shutdown
 * sequence. See `tracing-shutdown.hook.ts`.
 */
@Module({ providers: [TracingShutdownHook] })
export class TracingShutdownModule {}
