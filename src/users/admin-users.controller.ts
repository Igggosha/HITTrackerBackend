import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListUserActivityDto, ListUsersDto } from './dto/list-users.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id/activity')
  activity(
    @Req() request: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
    @Query() query: ListUserActivityDto,
  ) {
    return this.usersService.getAdminUserActivity(
      request.user!.id!,
      targetUserId,
      query,
    );
  }

  @Get(':id')
  details(
    @Req() request: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
  ) {
    return this.usersService.getAdminUserDetails(
      request.user!.id!,
      targetUserId,
    );
  }

  @Patch(':id/role')
  updateRole(
    @Req() request: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateUserRole(request.user!.id!, targetUserId, dto.role);
  }

  @Delete(':id')
  remove(@Req() request: Request, @Param('id', ParseIntPipe) targetUserId: number) {
    return this.usersService.deleteUser(request.user!.id!, targetUserId);
  }
}
