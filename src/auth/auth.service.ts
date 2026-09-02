import {
  BadRequestException,
  ConflictException,
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
import { users, type UserRole } from '../db/schema';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';

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
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const [user] = await db
      .insert(users)
      .values({
        email: dto.email,
        username: dto.email.split('@')[0],
        passwordHash,
      })
      .returning();

    return this.createAuthResponse('Registration successful', user);
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
}
