import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { generateSecret, generateURI, verify } from 'otplib';
import { createHash, randomBytes } from 'node:crypto';
import { db, primaryDb } from '../db/db';
import {
  authMfaChallenges,
  authRefreshSessions,
  authTotpCredentials,
  users,
} from '../db/schema';
import type { DbTransaction } from '../outbox/transaction';
import { recordUserActivity } from '../users/user-activity';
import { requiresMfa } from './roles';
import {
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  hashMfaChallenge,
  hashRecoveryCode,
  isTotpSecretEncryptedWithCurrentKey,
  parseTotpEncryptionKeys,
  type TotpEncryptionKey,
} from './mfa-crypto';

const CHALLENGE_TTL_MS = 5 * 60_000;
const ISSUER = 'Hit Tracker';

type MfaUser = Pick<
  typeof users.$inferSelect,
  'id' | 'email' | 'username' | 'displayName' | 'role' | 'isSystemOwner'
>;

@Injectable()
export class MfaService {
  private readonly keys: TotpEncryptionKey[];

  constructor(config: ConfigService) {
    let raw = config.get<string>('TOTP_ENCRYPTION_KEYS');
    if (!raw && process.env.NODE_ENV !== 'production') {
      const developmentSecret = config.get<string>('OAUTH_SESSION_SECRET');
      if (developmentSecret) {
        raw = createHash('sha256')
          .update(`hit-tracker:totp:${developmentSecret}`)
          .digest('base64');
      }
    }
    this.keys = parseTotpEncryptionKeys(raw ?? '');
  }

  async prepareLogin(user: MfaUser) {
    if (!requiresMfa(user.role)) return null;
    const [credential] = await primaryDb
      .select({ enabledAt: authTotpCredentials.enabledAt })
      .from(authTotpCredentials)
      .where(eq(authTotpCredentials.userId, user.id))
      .limit(1);
    const challengeToken = randomBytes(32).toString('base64url');
    await db.transaction(async (tx) => {
      await tx
        .delete(authMfaChallenges)
        .where(
          and(
            eq(authMfaChallenges.userId, user.id),
            or(
              lt(authMfaChallenges.expiresAt, new Date()),
              isNotNull(authMfaChallenges.consumedAt),
            ),
          ),
        );
      await tx.insert(authMfaChallenges).values({
        userId: user.id,
        tokenHash: hashMfaChallenge(challengeToken),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      });
    });
    return {
      mfaRequired: true as const,
      enrollmentRequired: !credential?.enabledAt,
      challengeToken,
      user,
    };
  }

  async beginEnrollment(challengeToken: string) {
    return db.transaction(async (tx) => {
      const user = await this.getChallengeUser(tx, challengeToken);
      if (!requiresMfa(user.role)) {
        throw new ForbiddenException({ code: 'TOTP_NOT_REQUIRED' });
      }
      const [existing] = await tx
        .select()
        .from(authTotpCredentials)
        .where(eq(authTotpCredentials.userId, user.id))
        .limit(1)
        .for('update');
      if (existing?.enabledAt) {
        throw new ConflictException({ code: 'TOTP_ALREADY_ENABLED' });
      }
      const secret = existing
        ? decryptTotpSecret(existing.secretCiphertext, this.keys)
        : generateSecret();
      if (!existing) {
        await tx.insert(authTotpCredentials).values({
          userId: user.id,
          secretCiphertext: encryptTotpSecret(secret, this.keys),
        });
      } else if (
        !isTotpSecretEncryptedWithCurrentKey(
          existing.secretCiphertext,
          this.keys,
        )
      ) {
        await tx
          .update(authTotpCredentials)
          .set({
            secretCiphertext: encryptTotpSecret(secret, this.keys),
            updatedAt: new Date(),
          })
          .where(eq(authTotpCredentials.userId, user.id));
      }
      return {
        secret,
        otpauthUri: generateURI({
          issuer: ISSUER,
          label: user.email,
          secret,
        }),
      };
    });
  }

  async confirmEnrollment(challengeToken: string, code: string) {
    return db.transaction(async (tx) => {
      const user = await this.getChallengeUser(tx, challengeToken);
      if (!requiresMfa(user.role)) {
        throw new ForbiddenException({ code: 'TOTP_NOT_REQUIRED' });
      }
      const credential = await this.getCredentialForUpdate(tx, user.id);
      if (credential.enabledAt) {
        throw new ConflictException({ code: 'TOTP_ALREADY_ENABLED' });
      }
      const secret = decryptTotpSecret(credential.secretCiphertext, this.keys);
      const result = await verify({
        secret,
        token: code,
        epochTolerance: 30,
      });
      if (!result.valid) throw this.invalidFactor();

      const recoveryCodes = createRecoveryCodes();
      const now = new Date();
      await tx
        .update(authTotpCredentials)
        .set({
          secretCiphertext: encryptTotpSecret(secret, this.keys),
          enabledAt: now,
          lastUsedTimeStep: this.timeStep(result),
          recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
          recoveryCodesGeneratedAt: now,
          updatedAt: now,
        })
        .where(eq(authTotpCredentials.userId, user.id));
      await this.consumeChallenge(tx, challengeToken);
      await recordUserActivity(
        {
          userId: user.id,
          actorUserId: user.id,
          type: 'account.mfa_enabled',
        },
        tx,
      );
      return { user, recoveryCodes, mfaVerifiedAt: now };
    });
  }

  async verifyChallenge(
    challengeToken: string,
    factor: { code?: string; recoveryCode?: string },
  ) {
    if (Boolean(factor.code) === Boolean(factor.recoveryCode)) {
      throw new UnauthorizedException({ code: 'MFA_FACTOR_REQUIRED' });
    }
    return db.transaction(async (tx) => {
      const user = await this.getChallengeUser(tx, challengeToken);
      if (!requiresMfa(user.role)) {
        throw new UnauthorizedException({ code: 'MFA_CHALLENGE_INVALID' });
      }
      const credential = await this.getCredentialForUpdate(tx, user.id);
      if (!credential.enabledAt) {
        throw new ForbiddenException({ code: 'TOTP_ENROLLMENT_REQUIRED' });
      }
      if (factor.code) {
        await this.verifyAndAdvanceTotp(tx, credential, factor.code);
      } else {
        const wanted = hashRecoveryCode(factor.recoveryCode!);
        const remaining = credential.recoveryCodeHashes.filter(
          (candidate) => candidate !== wanted,
        );
        if (remaining.length === credential.recoveryCodeHashes.length) {
          throw this.invalidFactor();
        }
        const secretCiphertext = isTotpSecretEncryptedWithCurrentKey(
          credential.secretCiphertext,
          this.keys,
        )
          ? credential.secretCiphertext
          : encryptTotpSecret(
              decryptTotpSecret(credential.secretCiphertext, this.keys),
              this.keys,
            );
        await tx
          .update(authTotpCredentials)
          .set({
            secretCiphertext,
            recoveryCodeHashes: remaining,
            updatedAt: new Date(),
          })
          .where(eq(authTotpCredentials.userId, user.id));
        await recordUserActivity(
          {
            userId: user.id,
            actorUserId: user.id,
            type: 'account.mfa_recovery_used',
            metadata: { remaining: remaining.length },
          },
          tx,
        );
      }
      await this.consumeChallenge(tx, challengeToken);
      return { user, mfaVerifiedAt: new Date() };
    });
  }

  async status(userId: number) {
    const [user] = await primaryDb
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new UnauthorizedException();
    const [credential] = await primaryDb
      .select({
        enabledAt: authTotpCredentials.enabledAt,
        recoveryCodeHashes: authTotpCredentials.recoveryCodeHashes,
      })
      .from(authTotpCredentials)
      .where(eq(authTotpCredentials.userId, userId))
      .limit(1);
    return {
      required: requiresMfa(user.role),
      enabled: Boolean(credential?.enabledAt),
      recoveryCodesRemaining: credential?.recoveryCodeHashes.length ?? 0,
    };
  }

  async regenerateRecoveryCodes(userId: number, code: string) {
    return db.transaction(async (tx) => {
      const credential = await this.getCredentialForUpdate(tx, userId);
      if (!credential.enabledAt) {
        throw new ForbiddenException({ code: 'TOTP_NOT_ENABLED' });
      }
      await this.verifyAndAdvanceTotp(tx, credential, code);
      const recoveryCodes = createRecoveryCodes();
      await tx
        .update(authTotpCredentials)
        .set({
          recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
          recoveryCodesGeneratedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(authTotpCredentials.userId, userId));
      await recordUserActivity(
        {
          userId,
          actorUserId: userId,
          type: 'account.mfa_recovery_regenerated',
        },
        tx,
      );
      return { recoveryCodes };
    });
  }

  async disable(userId: number, code: string) {
    return db.transaction(async (tx) => {
      const [user] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update');
      if (!user) throw new UnauthorizedException();
      if (requiresMfa(user.role)) {
        throw new ForbiddenException({ code: 'TOTP_REQUIRED_FOR_ROLE' });
      }
      const credential = await this.getCredentialForUpdate(tx, userId);
      await this.verifyAndAdvanceTotp(tx, credential, code);
      await tx
        .delete(authTotpCredentials)
        .where(eq(authTotpCredentials.userId, userId));
      await tx
        .update(authRefreshSessions)
        .set({ revokedAt: new Date(), revocationReason: 'mfa_disabled' })
        .where(
          and(
            eq(authRefreshSessions.userId, userId),
            isNull(authRefreshSessions.revokedAt),
          ),
        );
      await recordUserActivity(
        {
          userId,
          actorUserId: userId,
          type: 'account.mfa_disabled',
        },
        tx,
      );
      return { message: 'Two-factor authentication disabled' };
    });
  }

  private async getChallengeUser(
    tx: DbTransaction,
    challengeToken: string,
  ): Promise<MfaUser> {
    const [challenge] = await tx
      .select({ userId: authMfaChallenges.userId })
      .from(authMfaChallenges)
      .where(
        and(
          eq(authMfaChallenges.tokenHash, hashMfaChallenge(challengeToken)),
          isNull(authMfaChallenges.consumedAt),
          gt(authMfaChallenges.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for('update');
    if (!challenge) {
      throw new UnauthorizedException({ code: 'MFA_CHALLENGE_INVALID' });
    }
    const [user] = await tx
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        isSystemOwner: users.isSystemOwner,
      })
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1)
      .for('update');
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private async consumeChallenge(tx: DbTransaction, challengeToken: string) {
    const [consumed] = await tx
      .update(authMfaChallenges)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authMfaChallenges.tokenHash, hashMfaChallenge(challengeToken)),
          isNull(authMfaChallenges.consumedAt),
        ),
      )
      .returning({ id: authMfaChallenges.id });
    if (!consumed) {
      throw new UnauthorizedException({ code: 'MFA_CHALLENGE_INVALID' });
    }
  }

  private async getCredentialForUpdate(tx: DbTransaction, userId: number) {
    const [credential] = await tx
      .select()
      .from(authTotpCredentials)
      .where(eq(authTotpCredentials.userId, userId))
      .limit(1)
      .for('update');
    if (!credential) {
      throw new ForbiddenException({ code: 'TOTP_ENROLLMENT_REQUIRED' });
    }
    return credential;
  }

  private async verifyAndAdvanceTotp(
    tx: DbTransaction,
    credential: typeof authTotpCredentials.$inferSelect,
    code: string,
  ) {
    const secret = decryptTotpSecret(credential.secretCiphertext, this.keys);
    const result = await verify({
      secret,
      token: code,
      epochTolerance: 30,
      ...(credential.lastUsedTimeStep === null
        ? {}
        : { afterTimeStep: credential.lastUsedTimeStep }),
    });
    if (!result.valid) throw this.invalidFactor();
    const secretCiphertext = isTotpSecretEncryptedWithCurrentKey(
      credential.secretCiphertext,
      this.keys,
    )
      ? credential.secretCiphertext
      : encryptTotpSecret(secret, this.keys);
    await tx
      .update(authTotpCredentials)
      .set({
        secretCiphertext,
        lastUsedTimeStep: this.timeStep(result),
        updatedAt: new Date(),
      })
      .where(eq(authTotpCredentials.userId, credential.userId));
  }

  private invalidFactor() {
    return new UnauthorizedException({ code: 'MFA_FACTOR_INVALID' });
  }

  private timeStep(result: { valid: true }): number {
    // `otplib` exposes a combined HOTP/TOTP result type, while the runtime
    // function used here is TOTP and always includes the RFC 6238 time step.
    return (result as { valid: true; timeStep: number }).timeStep;
  }
}
