import { ForbiddenException } from '@nestjs/common';
import {
  assertNotSuspended,
  assertSessionNotRevoked,
} from './account-suspension';

describe('account suspension', () => {
  it('returns a stable structured error for an active suspension', () => {
    const expiresAt = new Date(Date.now() + 60_000);
    try {
      assertNotSuspended({
        suspendedUntil: expiresAt,
        suspensionReason: 'Compromised account',
      });
      throw new Error('expected suspension error');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        message: 'Account suspended',
        code: 'ACCOUNT_BANNED',
        expiresAt: expiresAt.toISOString(),
        reason: 'Compromised account',
      });
    }
  });

  it('allows an expired suspension', () => {
    expect(() =>
      assertNotSuspended({
        suspendedUntil: new Date(Date.now() - 1),
        suspensionReason: 'Expired',
      }),
    ).not.toThrow();
  });

  it('rejects access tokens issued before a global session revocation', () => {
    const invalidBefore = new Date();
    expect(() =>
      assertSessionNotRevoked(
        {
          suspendedUntil: null,
          suspensionReason: null,
          sessionsInvalidBefore: invalidBefore,
        },
        invalidBefore.getTime() - 1,
      ),
    ).toThrow('Session revoked');
    expect(() =>
      assertSessionNotRevoked(
        {
          suspendedUntil: null,
          suspensionReason: null,
          sessionsInvalidBefore: invalidBefore,
        },
        invalidBefore.getTime() + 1,
      ),
    ).not.toThrow();
  });
});
