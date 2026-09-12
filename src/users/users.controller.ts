import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUsernameDto } from './dto/update-username.dto';
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
}
