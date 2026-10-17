// EN: Wires user-facing and administrative controllers to the shared UsersService and storage integration.
// UK: З'єднує користувацький та адміністративний контролери зі спільним UsersService й інтеграцією сховища.

import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, RolesGuard],
})
export class UsersModule {}
