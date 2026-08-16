import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(_context: ExecutionContext) {
    return { scope: ['email', 'profile'], session: false, state: true };
  }

  handleRequest(err: unknown, user: unknown, info: unknown, context: ExecutionContext, status?: unknown) {
    const request = context.switchToHttp().getRequest();
    if (request.query.error === 'access_denied') return { cancelled: true };
    return super.handleRequest(err, user, info, context, status);
  }
}
