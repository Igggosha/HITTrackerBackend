import { createHash } from 'node:crypto';
import type { Request } from 'express';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export function ipRateLimitTracker(request: Request): string {
  return `ip:${request.ip || request.socket.remoteAddress || 'unknown'}`;
}

export function principalRateLimitTracker(request: Request): string {
  if (request.user?.id) return `user:${request.user.id}`;
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return `bearer:${digest(authorization.slice('Bearer '.length))}`;
  }
  const email = (request.body as { email?: unknown } | undefined)?.email;
  if (typeof email === 'string' && email.trim()) {
    return `email:${digest(email.trim().toLowerCase())}`;
  }
  const challenge = (request.body as { challengeToken?: unknown } | undefined)
    ?.challengeToken;
  if (typeof challenge === 'string' && challenge) {
    return `challenge:${digest(challenge)}`;
  }
  const bodyRefresh = (request.body as { refreshToken?: unknown } | undefined)
    ?.refreshToken;
  const cookieRefresh = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('hit_tracker_refresh='))
    ?.slice('hit_tracker_refresh='.length);
  const refresh =
    typeof bodyRefresh === 'string' && bodyRefresh
      ? bodyRefresh
      : cookieRefresh;
  return refresh ? `refresh:${digest(refresh)}` : ipRateLimitTracker(request);
}
