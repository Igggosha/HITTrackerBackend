import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { FirebaseModule } from '../firebase/firebase.module';
import { StorageModule } from '../storage/storage.module';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationReminderService } from './notification-reminder.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushTokenCrypto } from './push-token.crypto';

@Module({
  imports: [FirebaseModule, StorageModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    NotificationsService,
    NotificationDeliveryService,
    NotificationReminderService,
    PushTokenCrypto,
    RolesGuard,
  ],
  exports: [
    NotificationsService,
    NotificationDeliveryService,
    NotificationReminderService,
  ],
})
export class NotificationsModule {}
