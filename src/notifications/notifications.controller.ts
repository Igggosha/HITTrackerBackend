import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import {
  ListNotificationsDto,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('preferences')
  preferences(@Req() request: Request) {
    return this.notifications.getPreferences(request.user!.id!);
  }

  @Patch('preferences')
  updatePreferences(
    @Req() request: Request,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(request.user!.id!, dto);
  }

  @Put('devices')
  registerDevice(@Req() request: Request, @Body() dto: RegisterPushDeviceDto) {
    return this.notifications.registerDevice(request.user!.id!, dto);
  }

  @Delete('devices/:installationId')
  unregisterDevice(
    @Req() request: Request,
    @Param('installationId', new ParseUUIDPipe({ version: '4' }))
    installationId: string,
  ) {
    return this.notifications.unregisterDevice(
      request.user!.id!,
      installationId,
    );
  }

  @Get()
  list(@Req() request: Request, @Query() query: ListNotificationsDto) {
    return this.notifications.list(request.user!.id!, query.page, query.limit);
  }

  @Patch(':id/read')
  markRead(
    @Req() request: Request,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.notifications.markRead(request.user!.id!, id);
  }

  @Post('read-all')
  markAllRead(@Req() request: Request) {
    return this.notifications.markAllRead(request.user!.id!);
  }

  @Post('test')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  sendTest(@Req() request: Request) {
    return this.notifications.sendTest(request.user!.id!);
  }
}
