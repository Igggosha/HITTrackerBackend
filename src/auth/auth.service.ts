import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { RegisterDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  // Временное хранилище пользователей вместо БД
  private users: { id: string; email: string; password: string }[] = [];

  async register(dto: RegisterDto) {
    const existingUser = this.users.find((u) => u.email === dto.email);
    if (existingUser) {
      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const newUser = {
      id: Date.now().toString(),
      email: dto.email,
      password: dto.password, // В реальном проекте хешируем через bcrypt
    };

    this.users.push(newUser);

    return {
      message: 'Регистрация успешна',
      token: `fake-jwt-token-${newUser.id}`,
      user: { id: newUser.id, email: newUser.email },
    };
  }

  async login(dto: LoginDto) {
    const user = this.users.find((u) => u.email === dto.email);
    if (!user || user.password !== dto.password) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    return {
      message: 'Вход выполнен',
      token: `fake-jwt-token-${user.id}`,
      user: { id: user.id, email: user.email },
    };
  }
}