import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { db } from '../db/db';
import { users } from '../db/schema';
import { LoginDto, RegisterDto } from './dto/auth.dto';

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

    return {
      message: 'Registration successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
      accessToken: this.jwtService.sign({ sub: user.id, email: user.email }),
    };
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

    const valid = await bcrypt.compare(password, user.passwordHash);
    
    // ЯКЩО ПАРОЛЬ НЕВІРНИЙ -> залишаємо 401 (UnauthorizedException)
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.email, dto.password);

    return {
      message: 'Login successful',
      accessToken: this.jwtService.sign({
        sub: user.id,
        email: user.email,
      }),
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    };
  }
}