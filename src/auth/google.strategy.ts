import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { GoogleUser } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID ?? 'missing-google-client-id',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? 'missing-google-client-secret',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ??
        'http://localhost:3000/auth/google/callback',
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    const email = profile.emails?.find(({ verified }) => verified)?.value;

    if (!email) {
      return done(new UnauthorizedException('Google did not provide a verified email'));
    }

    const user: GoogleUser = { email, googleId: profile.id };
    return done(null, user);
  }
}
