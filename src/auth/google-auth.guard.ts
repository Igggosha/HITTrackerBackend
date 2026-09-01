import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();

    // Keep the client type in the OAuth session. Passport owns the `state`
    // parameter, so it must not be repurposed for application data.
    if (request.query.platform === 'mobile') {
      request.session.oauthPlatform = 'mobile';
    }

    return { scope: ['email', 'profile'], session: false, state: true };
  }

  handleRequest(err: unknown, user: unknown, info: unknown, context: ExecutionContext, status?: unknown) {
    const request = context.switchToHttp().getRequest();
    if (request.query.error === 'access_denied') return { cancelled: true };
    return super.handleRequest(err, user, info, context, status);
  }
}
