import { BadRequestException, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();

    // Keep the client type in the OAuth session. Passport owns the `state`
    // parameter, so it must not be repurposed for application data.
    if (request.query.platform === 'mobile') {
      const codeChallenge = request.query.code_challenge;
      if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
        throw new BadRequestException('A valid PKCE code_challenge is required for mobile OAuth.');
      }
      request.session.oauthPlatform = 'mobile';
      request.session.oauthCodeChallenge = codeChallenge;
    }

    return { scope: ['email', 'profile'], session: false, state: true };
  }

  handleRequest(err: unknown, user: unknown, info: unknown, context: ExecutionContext, status?: unknown) {
    const request = context.switchToHttp().getRequest();
    if (request.query.error === 'access_denied') return { cancelled: true };
    return super.handleRequest(err, user, info, context, status);
  }
}
