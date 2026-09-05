import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { db } from '../db/db';
import { oauthLoginCodes, pendingRegistrations, users, type UserRole } from '../db/schema';
import { ExchangeOAuthCodeDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyRegistrationDto } from './dto/auth.dto';
import { createEmailVerificationCode } from './email-verification-code';
import { hashOAuthCode, verifyPkce } from './oauth-pkce';
import { hashPasswordResetToken } from './password-reset-token';

export type GoogleUser = {
  email: string;
  googleId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.fullName.trim();
    if (!username) throw new BadRequestException('Full name is required');

    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const [existingUsername] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUsername) {
      throw new ConflictException('Name is already in use');
    }

    const [pending] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.email, email))
      .limit(1);
    const now = new Date();
    if (pending?.lockedUntil && pending.lockedUntil > now) {
      throw new HttpException({
        message: 'Too many invalid codes. Please try again later.',
        retryAfterSeconds: Math.ceil((pending.lockedUntil.getTime() - now.getTime()) / 1000),
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (pending?.lockedUntil || (pending && pending.expiresAt <= now)) {
      await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const code = createEmailVerificationCode();
    const verificationCodeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db
      .insert(pendingRegistrations)
      .values({
        email,
        username,
        passwordHash,
        verificationCodeHash,
        expiresAt,
        attempts: 0,
      })
      .onConflictDoUpdate({
        target: pendingRegistrations.email,
        set: {
          username,
          passwordHash,
          verificationCodeHash,
          expiresAt,
          attempts: 0,
          lockedUntil: null,
        },
      });

    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your HitTracker account',
      html: `<p>Your confirmation code is <strong>${code}</strong>.</p><p>It expires in 15 minutes.</p>`,
    });

    return { message: 'A confirmation code has been sent to your email.' };
  }

  async verifyRegistration(dto: VerifyRegistrationDto) {
    const email = dto.email.trim().toLowerCase();
    const [pending] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.email, email))
      .limit(1);

    const now = new Date();
    if (!pending) {
      throw new BadRequestException({
        message: 'Registration request not found or expired.',
        code: 'REGISTRATION_NOT_FOUND',
      });
    }

    if (pending.lockedUntil && pending.lockedUntil > now) {
      throw new HttpException({
        message: 'Too many invalid codes. Please try again later.',
        retryAfterSeconds: Math.ceil((pending.lockedUntil.getTime() - now.getTime()) / 1000),
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    if (pending.lockedUntil || pending.expiresAt <= now) {
      await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
      throw new GoneException({
        message: 'Verification code has expired.',
        code: 'VERIFICATION_CODE_EXPIRED',
      });
    }

    const validCode = await bcrypt.compare(dto.code, pending.verificationCodeHash);
    if (!validCode) {
      const attempts = pending.attempts + 1;
      if (attempts >= 5) {
        const lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        await db
          .update(pendingRegistrations)
          .set({ attempts, lockedUntil, verificationCodeHash: '' })
          .where(eq(pendingRegistrations.email, email));
        throw new HttpException({
          message: 'Too many invalid codes. Please try again later.',
          retryAfterSeconds: 30 * 60,
        }, HttpStatus.TOO_MANY_REQUESTS);
      } else {
        await db
          .update(pendingRegistrations)
          .set({ attempts })
          .where(eq(pendingRegistrations.email, email));
      }
      throw new BadRequestException({
        message: 'Invalid verification code.',
        code: 'INVALID_VERIFICATION_CODE',
        ...(attempts >= 2 ? { attemptsRemaining: 5 - attempts } : {}),
      });
    }

    await db.transaction(async (tx) => {
      const [existingUser] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (existingUser) throw new ConflictException('User already exists');

      const [newUser] = await tx
        .insert(users)
        .values({
          email,
          username: pending.username,
          passwordHash: pending.passwordHash,
        })
        .returning();

      await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
      return newUser;
    });

    return { message: 'Registration successful' };
  }

  async validateUser(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('This account uses Google sign-in');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    return this.createAuthResponse('Login successful', user);
  }

  async loginWithGoogle(googleUser: GoogleUser) {
    const [userByGoogleId] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleUser.googleId))
      .limit(1);

    if (userByGoogleId) {
      return this.createAuthResponse('Google login successful', userByGoogleId);
    }

    const [userByEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email))
      .limit(1);

    if (userByEmail) {
      const [linkedUser] = await db
        .update(users)
        .set({ googleId: googleUser.googleId })
        .where(eq(users.id, userByEmail.id))
        .returning();

      return this.createAuthResponse('Google account linked successfully', linkedUser);
    }

    const [newUser] = await db
      .insert(users)
      .values({
        email: googleUser.email,
        username: googleUser.email,
        googleId: googleUser.googleId,
      })
      .returning();

    return this.createAuthResponse('Google registration successful', newUser);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const [user] = await db
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

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:8081';
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

  async resetPassword(dto: ResetPasswordDto) {
    const [user] = await db
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

    await db
      .update(users)
      .set({
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      })
      .where(eq(users.id, user.id));

    return { message: 'Password successfully updated.' };
  }

  private createAuthResponse(
    message: string,
    user: { id: number; email: string; username: string; role: UserRole },
  ) {
    return {
      message,
      accessToken: this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

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
      throw new UnauthorizedException('Invalid or expired OAuth authorization code.');
    }

    const [user] = await db.select().from(users).where(eq(users.id, loginCode.userId)).limit(1);
    if (!user) throw new UnauthorizedException('OAuth user no longer exists.');
    return this.createAuthResponse('Google login successful', user);
  }
}
