import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { db } from '../db/db';
import { users } from '../db/schema';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export type GoogleUser = {
  email: string;
  googleId: string;
};

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

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

    // ЯКЩО ПОШТИ НЕМАЄ В БАЗІ -> кидаємо 404 (NotFoundException)
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('This account uses Google sign-in');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    
    // ЯКЩО ПАРОЛЬ НЕВІРНИЙ -> залишаємо 401 (UnauthorizedException)
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
        // An email is unique and avoids collisions between equal Google display names.
        username: googleUser.email,
        googleId: googleUser.googleId,
      })
      .returning();

    return this.createAuthResponse('Google registration successful', newUser);
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
