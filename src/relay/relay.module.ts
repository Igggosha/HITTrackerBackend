// EN: Composes the standalone relay from outbox publishing, metrics, and tracing-shutdown infrastructure.
// UK: Формує окремий relay з інфраструктури публікації outbox, метрик і завершення трасування.

import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { MetricsModule } from '../metrics/metrics.module';
import { TracingShutdownModule } from '../tracing/tracing-shutdown.module';
import { RelayService } from './relay.service';

@Module({
  imports: [OutboxModule, MetricsModule, TracingShutdownModule],
  providers: [RelayService],
})
export class RelayModule {}
