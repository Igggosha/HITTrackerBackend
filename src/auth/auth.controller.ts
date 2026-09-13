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
import {
  ExchangeOAuthCodeDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshSessionDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyRegistrationDto,
} from './dto/auth.dto';
import { GoogleAuthGuard } from './google-auth.guard';
import { REFRESH_TOKEN_TTL_MS } from './refresh-token';

const REFRESH_COOKIE = 'hit_tracker_refresh';

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
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);
    return this.deliverSession(response, result, dto.client === 'web');
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieToken = this.readRefreshCookie(request);
    try {
      const result = await this.authService.refreshSession(
        dto.refreshToken || cookieToken,
      );
      return this.deliverSession(response, result, !dto.refreshToken);
    } catch (error) {
      if (!dto.refreshToken) {
        response.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
      }
      throw error;
    }
  }

  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async logout(
    @Body() dto: RefreshSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.revokeRefreshSession(
      dto.refreshToken || this.readRefreshCookie(request),
    );
    response.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
    return { message: 'Logged out' };
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
  async googleAuthCallback(@Req() request: Request, @Res() response: Response) {
    if ((request.user as { cancelled?: boolean })?.cancelled) {
      return this.redirectGoogleError(request, response, 'access_denied');
    }

    const { redirectUrl, codeChallenge } = this.consumeOAuthRequest(request);
    const login = await this.authService.loginWithGoogle(
      request.user as GoogleUser,
    );

    if (!redirectUrl) {
      const result = await this.authService.createSession(
        login.message,
        login.user,
      );
      return response.json(this.deliverSession(response, result, true));
    }

    const url = new URL(redirectUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const result = await this.authService.createSession(
        login.message,
        login.user,
      );
      this.setRefreshCookie(response, result.refreshToken);
      url.hash = new URLSearchParams({
        accessToken: result.accessToken,
      }).toString();
    } else {
      if (!codeChallenge)
        return response.status(400).json({ error: 'missing_pkce_challenge' });
      const code = await this.authService.issueMobileOAuthCode(
        login.user,
        codeChallenge,
      );
      url.searchParams.set('code', code);
    }
    return response.redirect(url.toString());
  }

  private redirectGoogleError(
    request: Request,
    response: Response,
    error: string,
  ) {
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

  private deliverSession<T extends { refreshToken: string }>(
    response: Response,
    result: T,
    useCookie: boolean,
  ): T | Omit<T, 'refreshToken'> {
    if (!useCookie) return result;
    const { refreshToken, ...publicResult } = result;
    this.setRefreshCookie(response, refreshToken);
    return publicResult;
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      this.refreshCookieOptions(REFRESH_TOKEN_TTL_MS),
    );
  }

  private refreshCookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      maxAge,
      path: '/auth',
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
    };
  }

  private readRefreshCookie(request: Request): string | undefined {
    const entry = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${REFRESH_COOKIE}=`));
    if (!entry) return undefined;
    try {
      return decodeURIComponent(entry.slice(REFRESH_COOKIE.length + 1));
    } catch {
      return undefined;
    }
  }
}
