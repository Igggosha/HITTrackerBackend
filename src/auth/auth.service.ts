// EN: Implements the authentication domain: verified registration, credentials and Google login, rotating sessions, password reset, MFA, and mobile OAuth exchange.
// UK: Реалізує домен автентифікації: підтверджену реєстрацію, вхід через пароль і Google, ротацію сесій, скидання пароля, MFA та mobile OAuth-обмін.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { db, primaryDb } from '../db/db';
import {
  authRefreshSessions,
  oauthLoginCodes,
  pendingRegistrations,
  users,
  type UserRole,
} from '../db/schema';
import {
  ExchangeOAuthCodeDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyRegistrationDto,
} from './dto/auth.dto';
import { createEmailVerificationCode } from './email-verification-code';
import { hashOAuthCode, verifyPkce } from './oauth-pkce';
import { hashPasswordResetToken } from './password-reset-token';
import {
  ACCESS_TOKEN_TTL,
  createRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from './refresh-token';
import { recordUserActivity } from '../users/user-activity';
import { OutboxService } from '../outbox/outbox.service';
import type { DbTransaction } from '../outbox/transaction';
import { MfaService } from './mfa.service';
import { requiresMfa } from './roles';
import { assertNotSuspended } from './account-suspension';

export type GoogleUser = {
  email: string;
  googleId: string;
};

type VerificationOutcome =
  | { kind: 'not_found' }
  | { kind: 'locked'; lockedUntil: Date }
  | { kind: 'expired' }
  | { kind: 'too_many_attempts' }
  | { kind: 'invalid_code'; attempts: number }
  | { kind: 'registered' };

type AuthUser = {
  id: number;
  email: string;
  username: string | null;
  displayName: string;
  role: UserRole;
  isSystemOwner: boolean;
};

@Injectable()
export class AuthService {
  // EN: Receives infrastructure collaborators used for hashing, mail, JWT, MFA, and transactional outbox work.
  // UK: Приймає залежності для хешування, пошти, JWT, MFA та транзакційної outbox-роботи.
  constructor(
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly outbox: OutboxService,
    private readonly mfa: MfaService,
  ) {}

  // EN: Normalizes registration input, stores only hashes, and sends a time-limited verification code.
  // UK: Нормалізує реєстраційні дані, зберігає лише хеші та надсилає обмежений у часі код перевірки.
  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const displayName =
      dto.displayName?.trim() || dto.fullName?.trim() || email.split('@', 1)[0];

    const [existingUser] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      throw new ConflictException({
        message: 'User already exists',
        code: 'USER_ALREADY_EXISTS',
      });
    }

    const [pending] = await primaryDb
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.email, email))
      .limit(1);
    const now = new Date();
    if (pending?.lockedUntil && pending.lockedUntil > now) {
      throw new HttpException(
        {
          message: 'Too many invalid codes. Please try again later.',
          retryAfterSeconds: Math.ceil(
            (pending.lockedUntil.getTime() - now.getTime()) / 1000,
          ),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (pending?.lockedUntil || (pending && pending.expiresAt <= now)) {
      await db
        .delete(pendingRegistrations)
        .where(eq(pendingRegistrations.email, email));
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const code = createEmailVerificationCode();
    const verificationCodeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // The lock check above and this upsert are separate statements. The
    // `setWhere` repeats the check atomically, so a lockout set by a
    // concurrent failed verification is never reset by this request.
    const [stored] = await db
      .insert(pendingRegistrations)
      .values({
        email,
        displayName,
        passwordHash,
        verificationCodeHash,
        expiresAt,
        attempts: 0,
      })
      .onConflictDoUpdate({
        target: pendingRegistrations.email,
        set: {
          displayName,
          passwordHash,
          verificationCodeHash,
          expiresAt,
          attempts: 0,
          lockedUntil: null,
        },
        setWhere: or(
          isNull(pendingRegistrations.lockedUntil),
          lte(pendingRegistrations.lockedUntil, new Date()),
        ),
      })
      .returning({ email: pendingRegistrations.email });
    if (!stored) {
      throw new HttpException(
        {
          message: 'Too many invalid codes. Please try again later.',
          retryAfterSeconds: 30 * 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your HitTracker account',
      html: `<p>Your confirmation code is <strong>${code}</strong>.</p><p>It expires in 15 minutes.</p>`,
    });

    return { message: 'A confirmation code has been sent to your email.' };
  }

  // EN: Atomically verifies the code, creates the user, and records registration activity while preserving lockout counters.
  // UK: Атомарно перевіряє код, створює користувача й записує активність, зберігаючи лічильники блокування.
  async verifyRegistration(dto: VerifyRegistrationDto) {
    const email = dto.email.trim().toLowerCase();
    const now = new Date();

    let outcome: VerificationOutcome;
    try {
      outcome = await db.transaction(
        /* EN: Keeps verification attempts, lockout, cleanup, and user creation atomic. */
        /* UK: Робить атомарними спроби перевірки, блокування, очищення та створення користувача. */
        async (tx) => {
        // The row lock serializes attempts for one email. Without it, parallel
        // guesses all read the same attempt count and the five-attempt
        // lockout could be bypassed by sending many codes at once.
        const [pending] = await tx
          .select()
          .from(pendingRegistrations)
          .where(eq(pendingRegistrations.email, email))
          .for('update')
          .limit(1);

        if (!pending) return { kind: 'not_found' };

        if (pending.lockedUntil && pending.lockedUntil > now) {
          return { kind: 'locked', lockedUntil: pending.lockedUntil };
        }

        if (pending.lockedUntil || pending.expiresAt <= now) {
          await tx
            .delete(pendingRegistrations)
            .where(eq(pendingRegistrations.email, email));
          return { kind: 'expired' };
        }

        const validCode = await bcrypt.compare(
          dto.code,
          pending.verificationCodeHash,
        );
        if (!validCode) {
          const attempts = pending.attempts + 1;
          if (attempts >= 5) {
            const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
            await tx
              .update(pendingRegistrations)
              .set({ attempts, lockedUntil, verificationCodeHash: '' })
              .where(eq(pendingRegistrations.email, email));
            return { kind: 'too_many_attempts' };
          }
          await tx
            .update(pendingRegistrations)
            .set({ attempts })
            .where(eq(pendingRegistrations.email, email));
          return { kind: 'invalid_code', attempts };
        }

        const [existingUser] = await tx
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (existingUser) throw new ConflictException('User already exists');

        const [newUser] = await tx
          .insert(users)
          .values({
            email,
            username: null,
            displayName: pending.displayName,
            passwordHash: pending.passwordHash,
          })
          .returning();

        await tx
          .delete(pendingRegistrations)
          .where(eq(pendingRegistrations.email, email));
        await this.enqueueUserRegistered(tx, newUser, 'email');
        return { kind: 'registered' };
      });
    } catch (error: unknown) {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError.code === '23505') {
        throw new ConflictException({
          message: 'User already exists',
          code: 'USER_ALREADY_EXISTS',
        });
      }
      throw error;
    }

    // Errors are raised after the transaction so the attempt counter, the
    // lockout and the expired-row cleanup are committed, not rolled back.
    switch (outcome.kind) {
      case 'not_found':
        throw new BadRequestException({
          message: 'Registration request not found or expired.',
          code: 'REGISTRATION_NOT_FOUND',
        });
      case 'locked':
        throw new HttpException(
          {
            message: 'Too many invalid codes. Please try again later.',
            retryAfterSeconds: Math.ceil(
              (outcome.lockedUntil.getTime() - now.getTime()) / 1000,
            ),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'expired':
        throw new GoneException({
          message: 'Verification code has expired.',
          code: 'VERIFICATION_CODE_EXPIRED',
        });
      case 'too_many_attempts':
        throw new HttpException(
          {
            message: 'Too many invalid codes. Please try again later.',
            retryAfterSeconds: 30 * 60,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'invalid_code':
        throw new BadRequestException({
          message: 'Invalid verification code.',
          code: 'INVALID_VERIFICATION_CODE',
          ...(outcome.attempts >= 2
            ? { attemptsRemaining: 5 - outcome.attempts }
            : {}),
        });
      case 'registered':
        return { message: 'Registration successful' };
    }
  }

  // EN: Enqueues the durable registration event inside the caller's transaction.
  // UK: Додає надійну подію реєстрації всередині транзакції виклику.
  private async enqueueUserRegistered(
    tx: DbTransaction,
    user: { id: number; createdAt: Date },
    method: 'email' | 'google',
  ) {
    await this.outbox.enqueue(tx, {
      type: 'user.registered',
      aggregateId: user.id,
      payload: {
        userId: user.id,
        method,
        registeredAt: user.createdAt.toISOString(),
      },
    });
  }

  // EN: Validates password credentials against the primary database and rejects unverified, social-only, or suspended accounts.
  // UK: Перевіряє пароль у primary-базі та відхиляє непідтверджені, social-only або заблоковані акаунти.
  async validateUser(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      const [pending] = await primaryDb
        .select({ email: pendingRegistrations.email })
        .from(pendingRegistrations)
        .where(eq(pendingRegistrations.email, normalizedEmail))
        .limit(1);
      if (pending) {
        throw new ForbiddenException({
          message: 'Email verification is required',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException({
        message: 'This account uses Google sign-in',
        code: 'GOOGLE_SIGN_IN_REQUIRED',
      });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException({
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    assertNotSuspended(user);

    return user;
  }

  // EN: Performs password login and delegates MFA/session issuance to the common primary-login path.
  // UK: Виконує вхід за паролем і передає MFA/створення сесії спільному шляху входу.
  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);
    return this.completePrimaryLogin('Login successful', user);
  }

  // EN: Resolves an existing Google identity, links a matching email, or creates a new account with a race-safe fallback.
  // UK: Знаходить Google-ідентичність, пов'язує збіжний email або створює акаунт із безпечним конкурентним fallback.
  async loginWithGoogle(googleUser: GoogleUser) {
    const [userByGoogleId] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.googleId, googleUser.googleId))
      .limit(1);

    if (userByGoogleId) {
      assertNotSuspended(userByGoogleId);
      return {
        message: 'Google login successful',
        user: this.toPublicUser(userByGoogleId),
      };
    }

    const [userByEmail] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email))
      .limit(1);

    if (userByEmail) {
      assertNotSuspended(userByEmail);
      return this.linkGoogleAccount(userByEmail, googleUser.googleId);
    }

    try {
      const newUser = await db.transaction(
        /* EN: Makes Google account creation and its outbox event a single durable unit. */
        /* UK: Робить створення Google-акаунта та outbox-подію єдиною надійною одиницею. */
        async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email: googleUser.email,
            username: null,
            displayName: googleUser.email.split('@', 1)[0],
            googleId: googleUser.googleId,
          })
          .returning();
        await this.enqueueUserRegistered(tx, created, 'google');
        return created;
      });

      return {
        message: 'Google registration successful',
        user: this.toPublicUser(newUser),
      };
    } catch (error: unknown) {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError.code !== '23505') throw error;

      // Two concurrent first-time Google sign-ins for the same new account
      // both pass the checks above and race on the insert; the loser lands
      // here. Re-read on the primary rather than trusting the (possibly
      // lagging) replica: if the winner's row already carries this Google
      // id, this is the same identity, so complete the login exactly like
      // the userByGoogleId branch above.
      const [raced] = await primaryDb
        .select()
        .from(users)
        .where(eq(users.googleId, googleUser.googleId))
        .limit(1);
      if (raced) {
        assertNotSuspended(raced);
        return {
          message: 'Google login successful',
          user: this.toPublicUser(raced),
        };
      }

      // Otherwise the conflict was on the email alone: an account with this
      // email exists (created between our two lookups above) but isn't
      // linked to this Google id yet. Link it, consistent with the
      // userByEmail branch above, instead of failing the request.
      const [existing] = await primaryDb
        .select()
        .from(users)
        .where(eq(users.email, googleUser.email))
        .limit(1);
      if (!existing) throw error;
      assertNotSuspended(existing);
      return this.linkGoogleAccount(existing, googleUser.googleId);
    }
  }

  // EN: Links a Google identifier transactionally and records the security-relevant account activity.
  // UK: Транзакційно прив'язує Google-ідентифікатор і записує важливу для безпеки активність акаунта.
  private async linkGoogleAccount(
    userByEmail: typeof users.$inferSelect,
    googleId: string,
  ) {
    const linkedUser = await db.transaction(
      /* EN: Prevents a partially linked Google identity or missing activity record. */
      /* UK: Не допускає часткового linking Google-ідентичності або відсутнього запису активності. */
      async (tx) => {
      const [linked] = await tx
        .update(users)
        .set({ googleId })
        .where(eq(users.id, userByEmail.id))
        .returning();

      await recordUserActivity(
        {
          userId: userByEmail.id,
          actorUserId: userByEmail.id,
          type: 'account.google_linked',
        },
        tx,
      );
      return linked;
    });

    return {
      message: 'Google account linked successfully',
      user: this.toPublicUser(linkedUser),
    };
  }

  // EN: Creates a hashed, expiring reset token and always returns an enumeration-resistant response.
  // UK: Створює хешований токен скидання з терміном дії та завжди повертає відповідь без розкриття існування email.
  async forgotPassword(dto: ForgotPasswordDto) {
    const [user] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    if (!user) {
      return { message: 'If this email exists, a reset link has been sent.' };
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = hashPasswordResetToken(resetToken);
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 хвилин

    await db
      .update(users)
      .set({
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: expires,
      })
      .where(eq(users.id, user.id));

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8081';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Reset your password - HitTracker',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Click the link below to set a new password:</p>
          <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; color: white; background-color: #000; text-decoration: none; border-radius: 6px;">Reset Password</a>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">This link will expire in 15 minutes.</p>
        </div>
      `,
    });

    return { message: 'If this email exists, a reset link has been sent.' };
  }

  // EN: Atomically consumes the reset token, changes the password, and revokes prior sessions.
  // UK: Атомарно використовує токен, змінює пароль і відкликає попередні сесії.
  async resetPassword(dto: ResetPasswordDto) {
    const [user] = await primaryDb
      .select()
      .from(users)
      .where(
        and(
          eq(users.resetPasswordToken, hashPasswordResetToken(dto.token)),
          gt(users.resetPasswordExpires, new Date()),
        ),
      )
      .limit(1);

    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    const consumed = await db.transaction(
      /* EN: Ensures token consumption, password update, and session revocation commit together. */
      /* UK: Забезпечує спільний commit використання токена, зміни пароля та відкликання сесій. */
      async (tx) => {
      // The token is consumed only while it is still the stored, unexpired
      // one: of two concurrent resets with the same link exactly one wins.
      const [updated] = await tx
        .update(users)
        .set({
          passwordHash,
          resetPasswordToken: null,
          resetPasswordExpires: null,
          sessionsInvalidBefore: new Date(),
        })
        .where(
          and(
            eq(users.id, user.id),
            eq(users.resetPasswordToken, hashPasswordResetToken(dto.token)),
            gt(users.resetPasswordExpires, new Date()),
          ),
        )
        .returning({ id: users.id });
      if (!updated) return false;

      await tx
        .update(authRefreshSessions)
        .set({
          revokedAt: new Date(),
          revocationReason: 'password_changed',
        })
        .where(
          and(
            eq(authRefreshSessions.userId, user.id),
            isNull(authRefreshSessions.revokedAt),
          ),
        );
      await recordUserActivity(
        {
          userId: user.id,
          actorUserId: user.id,
          type: 'account.password_changed',
        },
        tx,
      );
      return true;
    });
    if (!consumed) {
      throw new BadRequestException('Invalid or expired password reset token.');
    }

    return { message: 'Password successfully updated.' };
  }

  // EN: Chooses MFA enrollment or direct session creation after a successful primary credential check.
  // UK: Після успішної первинної перевірки обирає MFA або безпосереднє створення сесії.
  async completePrimaryLogin(message: string, user: AuthUser) {
    return (
      (await this.mfa.prepareLogin(user)) ?? this.createSession(message, user)
    );
  }

  // EN: Creates a hashed rotating refresh session only after rechecking account state under a row lock.
  // UK: Створює хешовану refresh-сесію після повторної перевірки акаунта під блокуванням рядка.
  async createSession(message: string, user: AuthUser, mfaVerifiedAt?: Date) {
    const refreshToken = createRefreshToken();
    const sessionIssuedAt = await db.transaction(
      /* EN: Locks the account while issuing the refresh session so suspension cannot race the login. */
      /* UK: Блокує акаунт під час видачі refresh-сесії, щоб блокування не змагалося з login. */
      async (tx) => {
      const [account] = await tx
        .select({
          suspendedUntil: users.suspendedUntil,
          suspensionReason: users.suspensionReason,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .for('update')
        .limit(1);
      if (!account) throw new UnauthorizedException('Account no longer exists');
      assertNotSuspended(account);
      await tx.insert(authRefreshSessions).values({
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        mfaVerifiedAt,
      });
      return Date.now();
    });
    return this.createAuthResponse(
      message,
      user,
      refreshToken,
      Boolean(mfaVerifiedAt),
      sessionIssuedAt,
    );
  }

  // EN: Rotates refresh tokens transactionally and revokes an entire family when reuse is detected.
  // UK: Транзакційно ротує refresh-токени та відкликає всю сім'ю при виявленні повторного використання.
  async refreshSession(refreshToken: string | undefined) {
    if (!refreshToken) throw this.sessionExpired();
    const now = new Date();
    const outcome = await db.transaction(
      /* EN: Serializes refresh-token rotation and reuse detection for the token family. */
      /* UK: Серіалізує ротацію refresh-токена та виявлення повторного використання його сім'ї. */
      async (tx) => {
      const [session] = await tx
        .select()
        .from(authRefreshSessions)
        .where(
          eq(authRefreshSessions.tokenHash, hashRefreshToken(refreshToken)),
        )
        .for('update')
        .limit(1);
      if (!session || session.expiresAt <= now)
        return { kind: 'expired' } as const;
      if (session.revokedAt || session.usedAt) {
        await tx
          .update(authRefreshSessions)
          .set({ revokedAt: now, revocationReason: 'reuse_detected' })
          .where(eq(authRefreshSessions.familyId, session.familyId));
        return { kind: 'reused' } as const;
      }

      const [user] = await tx
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          displayName: users.displayName,
          role: users.role,
          isSystemOwner: users.isSystemOwner,
          suspendedUntil: users.suspendedUntil,
          suspensionReason: users.suspensionReason,
        })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!user) return { kind: 'expired' } as const;
      assertNotSuspended(user);
      if (requiresMfa(user.role) && !session.mfaVerifiedAt) {
        await tx
          .update(authRefreshSessions)
          .set({ revokedAt: now, revocationReason: 'mfa_required' })
          .where(eq(authRefreshSessions.familyId, session.familyId));
        return { kind: 'expired' } as const;
      }

      const nextRefreshToken = createRefreshToken();
      await tx
        .update(authRefreshSessions)
        .set({
          usedAt: now,
          revokedAt: now,
          revocationReason: 'rotated',
        })
        .where(eq(authRefreshSessions.id, session.id));
      await tx.insert(authRefreshSessions).values({
        userId: user.id,
        tokenHash: hashRefreshToken(nextRefreshToken),
        familyId: session.familyId,
        parentSessionId: session.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        mfaVerifiedAt: session.mfaVerifiedAt,
      });

      return {
        kind: 'refreshed' as const,
        response: this.createAuthResponse(
          'Session refreshed',
          user,
          nextRefreshToken,
          Boolean(session.mfaVerifiedAt),
          Date.now(),
        ),
      };
    });
    if (outcome.kind === 'reused') {
      throw new UnauthorizedException({
        message: 'Session reuse detected',
        code: 'REFRESH_TOKEN_REUSED',
      });
    }
    if (outcome.kind === 'expired') throw this.sessionExpired();
    return outcome.response;
  }

  // EN: Idempotently revokes one refresh session by its hash without logging the raw token.
  // UK: Ідемпотентно відкликає одну refresh-сесію за хешем, не журналюючи сирий токен.
  async revokeRefreshSession(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await db
      .update(authRefreshSessions)
      .set({ revokedAt: new Date(), revocationReason: 'logout' })
      .where(
        and(
          eq(authRefreshSessions.tokenHash, hashRefreshToken(refreshToken)),
          isNull(authRefreshSessions.revokedAt),
        ),
      );
  }

  // EN: Builds the public auth payload, signing short-lived access claims and stripping private user fields.
  // UK: Формує публічну auth-відповідь, підписує короткоживучі access claims і прибирає приватні поля.
  private createAuthResponse(
    message: string,
    user: AuthUser,
    refreshToken: string,
    mfaVerified: boolean,
    sessionIssuedAt: number,
  ) {
    return {
      message,
      accessToken: this.jwtService.sign(
        {
          sub: user.id,
          email: user.email,
          role: user.role,
          mfaVerified,
          sessionIssuedAt,
        },
        { expiresIn: ACCESS_TOKEN_TTL },
      ),
      refreshToken,
      user: this.toPublicUser(user),
    };
  }

  // EN: Starts MFA enrollment through the dedicated MFA service using its challenge token.
  // UK: Починає підключення MFA через спеціалізований сервіс за challenge-токеном.
  beginMfaEnrollment(challengeToken: string) {
    return this.mfa.beginEnrollment(challengeToken);
  }

  // EN: Confirms MFA enrollment, creates a verified session, and returns one-time recovery codes.
  // UK: Підтверджує MFA, створює перевірену сесію та повертає одноразові recovery-коди.
  async confirmMfaEnrollment(challengeToken: string, code: string) {
    const result = await this.mfa.confirmEnrollment(challengeToken, code);
    const session = await this.createSession(
      'Two-factor authentication enabled',
      result.user,
      result.mfaVerifiedAt,
    );
    return { ...session, recoveryCodes: result.recoveryCodes };
  }

  // EN: Verifies a TOTP or recovery factor and issues a session carrying the verification timestamp.
  // UK: Перевіряє TOTP або recovery-фактор і видає сесію з часом перевірки.
  async verifyMfaChallenge(
    challengeToken: string,
    factor: { code?: string; recoveryCode?: string },
  ) {
    const result = await this.mfa.verifyChallenge(challengeToken, factor);
    return this.createSession(
      'Login successful',
      result.user,
      result.mfaVerifiedAt,
    );
  }

  // EN: Returns current MFA enrollment state for an authenticated user.
  // UK: Повертає поточний стан підключення MFA для автентифікованого користувача.
  getMfaStatus(userId: number) {
    return this.mfa.status(userId);
  }

  // EN: Regenerates MFA recovery codes after the MFA service validates the supplied factor.
  // UK: Генерує нові MFA recovery-коди після перевірки фактора сервісом MFA.
  regenerateMfaRecoveryCodes(userId: number, code: string) {
    return this.mfa.regenerateRecoveryCodes(userId, code);
  }

  // EN: Disables MFA through the MFA service after code validation.
  // UK: Вимикає MFA через сервіс MFA після перевірки коду.
  disableMfa(userId: number, code: string) {
    return this.mfa.disable(userId, code);
  }

  // EN: Invalidates the user's session epoch and all active refresh sessions in one transaction.
  // UK: В одній транзакції інвалідує епоху сесій користувача та всі активні refresh-сесії.
  async revokeAllSessions(userId: number) {
    await db.transaction(
      /* EN: Commits the session epoch invalidation and row revocations together. */
      /* UK: Спільно фіксує інвалідацію епохи сесій і відкликання рядків. */
      async (tx) => {
      const revokedAt = new Date();
      await tx
        .update(users)
        .set({ sessionsInvalidBefore: revokedAt })
        .where(eq(users.id, userId));
      await tx
        .update(authRefreshSessions)
        .set({ revokedAt, revocationReason: 'logout_all' })
        .where(
          and(
            eq(authRefreshSessions.userId, userId),
            isNull(authRefreshSessions.revokedAt),
          ),
        );
    });
    return { message: 'All sessions revoked' };
  }

  // EN: Whitelists fields safe for API clients, excluding password and token material.
  // UK: Формує білий список полів для API, виключаючи паролі та матеріал токенів.
  private toPublicUser(user: AuthUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isSystemOwner: user.isSystemOwner,
    };
  }

  // EN: Creates the stable machine-readable exception used for missing or expired sessions.
  // UK: Створює стабільне машинозчитуване виключення для відсутніх або прострочених сесій.
  private sessionExpired() {
    return new UnauthorizedException({
      message: 'Session expired',
      code: 'SESSION_EXPIRED',
    });
  }

  // EN: Issues a short-lived, hashed mobile OAuth code bound to the PKCE challenge and user.
  // UK: Видає короткоживучий хешований mobile OAuth-код, пов'язаний із PKCE challenge та користувачем.
  async issueMobileOAuthCode(
    user: { id: number },
    codeChallenge: string,
  ): Promise<string> {
    const code = crypto.randomBytes(32).toString('base64url');
    await db.insert(oauthLoginCodes).values({
      codeHash: hashOAuthCode(code),
      codeChallenge,
      userId: user.id,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    return code;
  }

  // EN: Atomically consumes the mobile OAuth code, verifies PKCE, and continues through the primary-login path.
  // UK: Атомарно використовує mobile OAuth-код, перевіряє PKCE та продовжує спільним шляхом входу.
  async exchangeMobileOAuthCode(dto: ExchangeOAuthCodeDto) {
    const [loginCode] = await db
      .delete(oauthLoginCodes)
      .where(
        and(
          eq(oauthLoginCodes.codeHash, hashOAuthCode(dto.code)),
          gt(oauthLoginCodes.expiresAt, new Date()),
        ),
      )
      .returning();

    if (!loginCode || !verifyPkce(dto.codeVerifier, loginCode.codeChallenge)) {
      throw new UnauthorizedException(
        'Invalid or expired OAuth authorization code.',
      );
    }

    const [user] = await primaryDb
      .select()
      .from(users)
      .where(eq(users.id, loginCode.userId))
      .limit(1);
    if (!user) throw new UnauthorizedException('OAuth user no longer exists.');
    assertNotSuspended(user);
    return this.completePrimaryLogin('Google login successful', user);
  }
}
