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
import { primaryDb } from '../db/db';
import { authTotpCredentials, users } from '../db/schema';
import type { UserRole } from '../db/schema';
import { MINIMUM_ROLE_KEY } from './minimum-role.decorator';
import { hasMinimumRole, requiresMfa } from './roles';
import { assertNotSuspended } from './account-suspension';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const minimumRole = this.reflector.getAllAndOverride<UserRole>(
      MINIMUM_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!minimumRole) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException();

    const [user] = await primaryDb
      .select({
        role: users.role,
        mfaEnabledAt: authTotpCredentials.enabledAt,
        suspendedUntil: users.suspendedUntil,
        suspensionReason: users.suspensionReason,
      })
      .from(users)
      .leftJoin(authTotpCredentials, eq(authTotpCredentials.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorizedException();
    assertNotSuspended(user);
    request.user!.role = user.role;

    if (!hasMinimumRole(user.role, minimumRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (requiresMfa(user.role) && !user.mfaEnabledAt) {
      throw new ForbiddenException({
        message: 'Two-factor authentication enrollment is required',
        code: 'TOTP_ENROLLMENT_REQUIRED',
      });
    }
    if (requiresMfa(user.role) && !request.user?.mfaVerified) {
      throw new ForbiddenException({
        message: 'Two-factor authentication is required',
        code: 'TOTP_REQUIRED',
      });
    }

    return true;
  }
}
