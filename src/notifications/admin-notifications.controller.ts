import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtGuard } from '../auth/jwt.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateAdminNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('admin')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateAdminNotificationDto) {
    return this.notifications.createAdminNotification(dto);
  }
}
