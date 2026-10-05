import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { primaryDb } from '../db/db';
import { users } from '../db/schema';

type Suspension = {
  suspendedUntil: Date | null;
  suspensionReason: string | null;
};

type AccountAccess = Suspension & {
  sessionsInvalidBefore: Date | null;
};

export function assertNotSuspended(account: Suspension) {
  if (!account.suspendedUntil || account.suspendedUntil <= new Date()) return;
  throw new ForbiddenException({
    message: 'Account suspended',
    code: 'ACCOUNT_BANNED',
    expiresAt: account.suspendedUntil.toISOString(),
    reason: account.suspensionReason,
  });
}

export async function assertAccountMayAuthenticate(
  userId: number,
  sessionIssuedAt?: number,
) {
  const [account] = await primaryDb
    .select({
      suspendedUntil: users.suspendedUntil,
      suspensionReason: users.suspensionReason,
      sessionsInvalidBefore: users.sessionsInvalidBefore,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!account) throw new UnauthorizedException('Account no longer exists');
  assertNotSuspended(account);
  assertSessionNotRevoked(account, sessionIssuedAt);
}

export function assertSessionNotRevoked(
  account: AccountAccess,
  sessionIssuedAt?: number,
) {
  if (
    account.sessionsInvalidBefore &&
    (!sessionIssuedAt ||
      sessionIssuedAt <= account.sessionsInvalidBefore.getTime())
  ) {
    throw new UnauthorizedException({
      message: 'Session revoked',
      code: 'SESSION_REVOKED',
    });
  }
}
