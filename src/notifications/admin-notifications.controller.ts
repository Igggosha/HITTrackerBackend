import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.config';
import type { UploadedFile as UploadedImage } from '../storage/upload-validation';
import { CreateAdminNotificationDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('admin')
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @Throttle({
    default: { limit: 10, ttl: 60_000 },
    principal: { limit: 10, ttl: 60_000 },
  })
  create(
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAdminNotificationDto,
  ) {
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    return this.notifications.createAdminNotification(
      dto,
      request.user!.id!,
      idempotencyKey,
    );
  }

  @Post('media')
  @Throttle({
    default: { limit: 10, ttl: 60_000 },
    principal: { limit: 10, ttl: 60_000 },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1, fields: 0 },
    }),
  )
  uploadMedia(
    @Req() request: Request,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.notifications.uploadAdminMedia(request.user!.id!, file);
  }

  @Get('media')
  listMedia() {
    return this.notifications.listAdminMedia();
  }

  @Get('history')
  history() {
    return this.notifications.listAdminHistory();
  }
}
