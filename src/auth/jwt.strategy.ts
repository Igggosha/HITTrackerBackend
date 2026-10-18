// EN: Validates access-JWT claims against current account suspension and session-revocation state before attaching the principal.
// UK: Перевіряє claims access JWT за поточним станом блокування облікового запису й відкликання сесій до додавання користувача в запит.

import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserRole } from '../db/schema';
import { assertAccountMayAuthenticate } from './account-suspension';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // EN: Configures Passport to read bearer tokens and verify their signature with the server-only JWT secret.
  // UK: Налаштовує Passport на читання bearer token і перевірку його підпису серверним JWT secret.
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  // EN: Rechecks mutable account state for every protected request, then exposes only the principal fields used by guards and controllers.
  // UK: Для кожного захищеного запиту повторно перевіряє змінний стан акаунта й відкриває лише поля principal, потрібні guards і controllers.
  async validate(payload: {
    sub: number;
    email: string;
    role: UserRole;
    mfaVerified?: boolean;
    sessionIssuedAt?: number;
    iat?: number;
  }) {
    await assertAccountMayAuthenticate(
      payload.sub,
      payload.sessionIssuedAt ?? (payload.iat ? payload.iat * 1000 : undefined),
    );
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      mfaVerified: payload.mfaVerified === true,
    };
  }
}
