import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@UseGuards(JwtGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@Req() request: Request) {
    return this.usersService.getProfile(request.user!.id!);
  }

  @Patch('me')
  updateMe(@Req() request: Request, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(request.user!.id!, dto);
  }
}
