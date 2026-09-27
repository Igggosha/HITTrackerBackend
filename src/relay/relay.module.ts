import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { MetricsModule } from '../metrics/metrics.module';
import { RelayService } from './relay.service';

@Module({ imports: [OutboxModule, MetricsModule], providers: [RelayService] })
export class RelayModule {}
