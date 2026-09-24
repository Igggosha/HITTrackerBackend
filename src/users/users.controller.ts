import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { MAX_IMAGE_UPLOAD_BYTES } from '../storage/storage.config';
import type { UploadedFile as UploadedImage } from '../storage/upload-validation';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUsernameDto } from './dto/update-username.dto';
import {
  CreateBodyMetricDto,
  ListBodyMetricsDto,
} from './dto/body-metrics.dto';
import { UsersService } from './users.service';

@UseGuards(JwtGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() request: Request) {
    return this.usersService.getProfile(
      request.user!.id!,
      request.get('X-Profile-Contract') === 'v2',
    );
  }

  @Get('me/username-availability')
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  getUsernameAvailability(
    @Req() request: Request,
    @Query('username') username: string | undefined,
  ) {
    return this.usersService.getUsernameAvailability(
      request.user!.id!,
      username,
    );
  }

  @Patch('me')
  updateMe(@Req() request: Request, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(
      request.user!.id!,
      dto,
      request.get('X-Profile-Contract') === 'v2',
    );
  }

  @Patch('me/username')
  updateUsername(@Req() request: Request, @Body() dto: UpdateUsernameDto) {
    return this.usersService.updateUsername(request.user!.id!, dto.username);
  }

  @Post('me/presence')
  updatePresence(@Req() request: Request) {
    return this.usersService.touchPresence(request.user!.id!);
  }

  @Post('me/body-metrics')
  createBodyMetric(
    @Req() request: Request,
    @Body() dto: CreateBodyMetricDto,
  ) {
    return this.usersService.createBodyMetric(request.user!.id!, dto);
  }

  @Get('me/body-metrics')
  getBodyMetrics(
    @Req() request: Request,
    @Query() dto: ListBodyMetricsDto,
  ) {
    return this.usersService.getBodyMetrics(request.user!.id!, dto);
  }

  /**
   * Replaces the caller's avatar with the uploaded image.
   *
   * The interceptor limit is a memory guard: multer buffers the whole body, so
   * the request is cut off well before `MAX_UPLOAD_BYTES` is even checked.
   */
  @Post('me/avatar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_IMAGE_UPLOAD_BYTES,
        files: 1,
        fields: 0,
      },
    }),
  )
  uploadAvatar(
    @Req() request: Request,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.usersService.updateAvatar(
      request.user!.id!,
      file,
      request.get('X-Profile-Contract') === 'v2',
    );
  }

  @Delete('me/avatar')
  removeAvatar(@Req() request: Request) {
    return this.usersService.removeAvatar(
      request.user!.id!,
      request.get('X-Profile-Contract') === 'v2',
    );
  }
}
