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
import { pendingRegistrations, users } from '../db/schema';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyRegistrationDto } from './dto/auth.dto';

const VERIFICATION_CODE_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;

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
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const verificationCode = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const verificationCodeHash = await bcrypt.hash(verificationCode, 10);
    const verificationCodeExpires = new Date(Date.now() + VERIFICATION_CODE_TTL_MS);

    await db
      .insert(pendingRegistrations)
      .values({
        email,
        fullName: dto.fullName.trim(),
        passwordHash,
        verificationCodeHash,
        verificationCodeExpires,
      })
      .onConflictDoUpdate({
        target: pendingRegistrations.email,
        set: {
          fullName: dto.fullName.trim(),
          passwordHash,
          verificationCodeHash,
          verificationCodeExpires,
          attempts: 0,
          createdAt: new Date(),
        },
      });

    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirm your HitTracker email',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Confirm your email</h2>
          <p>Your verification code is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${verificationCode}</p>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">This code expires in 15 minutes.</p>
        </div>
      `,
    });

    return { message: 'Verification code sent' };
  }

  async verifyRegistration(dto: VerifyRegistrationDto) {
    const email = dto.email.trim().toLowerCase();
    const [pendingRegistration] = await db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.email, email))
      .limit(1);

    if (!pendingRegistration || pendingRegistration.verificationCodeExpires <= new Date()) {
      if (pendingRegistration) {
        await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
      }
      throw new GoneException({ code: 'CODE_EXPIRED', message: 'Verification code has expired. Please register again.' });
    }

    if (pendingRegistration.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      throw new HttpException('Too many incorrect codes. Please register again to get a new code.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const isValidCode = await bcrypt.compare(dto.code, pendingRegistration.verificationCodeHash);
    if (!isValidCode) {
      await db
        .update(pendingRegistrations)
        .set({ attempts: pendingRegistration.attempts + 1 })
        .where(eq(pendingRegistrations.email, email));
      throw new BadRequestException({ code: 'INVALID_CODE', message: 'Incorrect verification code.' });
    }

    const [user] = await db
      .insert(users)
      .values({
        email,
        username: email,
        fullName: pendingRegistration.fullName,
        passwordHash: pendingRegistration.passwordHash,
      })
      .returning();

    await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));

    return { message: 'Email verified. Account created.', user: { id: user.id, email: user.email } };
  }

  async validateUser(email: string, password: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
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
    const user = await this.validateUser(dto.email.trim().toLowerCase(), dto.password);

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
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 хвилин

    await db
      .update(users)
      .set({
        resetPasswordToken: resetToken,
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
          eq(users.resetPasswordToken, dto.token),
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
    user: { id: number; email: string; username: string },
  ) {
    return {
      message,
      accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    };
  }
}
