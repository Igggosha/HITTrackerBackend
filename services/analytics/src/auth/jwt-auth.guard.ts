import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

/** The main API's access-token claims (src/auth/auth.service.ts). */
export type AccessTokenClaims = { sub: number; email: string; role: string };
export type AuthUser = { id: number; role: string };
type AuthenticatedRequest = Request & { user?: AuthUser };

/**
 * Verifies the SAME short-lived access JWT the main API issues (shared
 * `JWT_SECRET`, HS256, `exp` enforced). The analytics service never issues
 * tokens and has no user table: `sub` is the only identity it needs.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : '';
    if (!token) throw new UnauthorizedException();
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (!Number.isInteger(claims.sub) || claims.sub < 1)
      throw new UnauthorizedException();
    request.user = { id: claims.sub, role: claims.role };
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user!,
);
