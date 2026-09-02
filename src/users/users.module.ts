import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, RolesGuard],
})
export class UsersModule {}
