import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListUsersDto } from './dto/list-users.dto';
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

  @Patch(':id/role')
  updateRole(
    @Req() request: Request,
    @Param('id', ParseIntPipe) targetUserId: number,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.usersService.updateUserRole(request.user!.id!, targetUserId, dto.role);
  }
}
