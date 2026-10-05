import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { UserRole } from '../db/schema';
import { assertAccountMayAuthenticate } from './account-suspension';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: {
    sub: number;
    email: string;
    role: UserRole;
    mfaVerified?: boolean;
  }) {
    await assertAccountMayAuthenticate(payload.sub);
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      mfaVerified: payload.mfaVerified === true,
    };
  }
}
