import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService, GoogleUser } from './auth.service';
import { ExchangeOAuthCodeDto, ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, VerifyRegistrationDto } from './dto/auth.dto';
import { GoogleAuthGuard } from './google-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('register/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 } })
  async verifyRegistration(@Body() dto: VerifyRegistrationDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('login')
  // Five tries per IP, then a 30-minute block. The guard supplies Retry-After.
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('oauth/exchange')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exchangeOAuthCode(@Body() dto: ExchangeOAuthCodeDto) {
    return this.authService.exchangeMobileOAuthCode(dto);
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if ((request.user as { cancelled?: boolean })?.cancelled) {
      return this.redirectGoogleError(request, response, 'access_denied');
    }

    const result = await this.authService.loginWithGoogle(request.user as GoogleUser);
    const { redirectUrl, codeChallenge } = this.consumeOAuthRequest(request);

    if (!redirectUrl) {
      return response.json(result);
    }

    const url = new URL(redirectUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.hash = new URLSearchParams({ accessToken: result.accessToken }).toString();
    } else {
      if (!codeChallenge) return response.status(400).json({ error: 'missing_pkce_challenge' });
      const code = await this.authService.issueMobileOAuthCode(result.user, codeChallenge);
      url.searchParams.set('code', code);
    }
    return response.redirect(url.toString());
  }

  private redirectGoogleError(request: Request, response: Response, error: string) {
    const { redirectUrl } = this.consumeOAuthRequest(request);
    if (!redirectUrl) return response.status(401).json({ error });

    const url = new URL(redirectUrl);
    url.searchParams.set('error', error);
    return response.redirect(url.toString());
  }

  private consumeOAuthRequest(request: Request) {
    const isMobile = request.session.oauthPlatform === 'mobile';
    const codeChallenge = request.session.oauthCodeChallenge;
    delete request.session.oauthPlatform;
    delete request.session.oauthCodeChallenge;

    return {
      redirectUrl: isMobile
        ? process.env.OAUTH_MOBILE_REDIRECT_URL
        : process.env.OAUTH_SUCCESS_REDIRECT_URL,
      codeChallenge,
    };
  }
}
