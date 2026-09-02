import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/db';
import { users } from '../db/schema';
import { MINIMUM_ROLE_KEY } from './minimum-role.decorator';
import { hasMinimumRole } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minimumRole = this.reflector.getAllAndOverride(MINIMUM_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minimumRole) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException();

    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();
    request.user!.role = user.role;

    if (!hasMinimumRole(user.role, minimumRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
