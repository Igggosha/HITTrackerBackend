import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TracingShutdownModule } from '../tracing/tracing-shutdown.module';
import { NotificationWorkerService } from './notification-worker.service';

@Module({
  imports: [NotificationsModule, TracingShutdownModule],
  providers: [NotificationWorkerService],
})
export class NotificationWorkerModule {}
