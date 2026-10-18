// EN: Defines the public authentication endpoints and adapts web cookies, mobile PKCE exchange, MFA, and OAuth redirects to AuthService.
// UK: Визначає публічні endpoints автентифікації та передає AuthService роботу з web-cookie, mobile PKCE, MFA й OAuth-перенаправленнями.

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
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
  MfaChallengeDto,
  MfaCodeDto,
  MfaVerifyDto,
  RefreshSessionDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyRegistrationDto,
} from './dto/auth.dto';
import { GoogleAuthGuard } from './google-auth.guard';
import { REFRESH_TOKEN_TTL_MS } from './refresh-token';
import { JwtGuard } from './jwt.guard';

const REFRESH_COOKIE = 'hit_tracker_refresh';

@Controller('auth')
export class AuthController {
  // EN: Injects the service that owns authentication rules; the controller only maps HTTP concerns.
  // UK: Впроваджує сервіс із правилами автентифікації; контролер відповідає лише за HTTP-взаємодію.
  constructor(private readonly authService: AuthService) {}

  // EN: Accepts validated registration data and returns the service's pending-registration result.
  // UK: Приймає перевірені дані реєстрації та повертає результат створення очікуваної реєстрації.
  @Post('register')
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    principal: { limit: 5, ttl: 60_000 },
  })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // EN: Verifies the one-time email code and exposes the resulting registration status.
  // UK: Перевіряє одноразовий email-код і повертає статус реєстрації.
  @Post('register/verify')
  @Throttle({
    default: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 },
    principal: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 },
  })
  async verifyRegistration(@Body() dto: VerifyRegistrationDto) {
    return this.authService.verifyRegistration(dto);
  }

  // EN: Authenticates credentials and puts web refresh tokens in cookies while keeping mobile tokens in JSON.
  // UK: Автентифікує облікові дані та кладе web refresh-токени в cookie, а mobile повертає в JSON.
  @Post('login')
  // Five tries per IP, then a 30-minute block. The guard supplies Retry-After.
  @Throttle({
    default: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 },
    principal: { limit: 5, ttl: 60_000, blockDuration: 30 * 60_000 },
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);
    return 'refreshToken' in result
      ? this.deliverSession(response, result, dto.client === 'web')
      : result;
  }

  // EN: Rotates a refresh session from either the request body or the secure cookie and clears a failed cookie flow.
  // UK: Ротує refresh-сесію з body або cookie та очищає cookie при невдалому cookie-сценарії.
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

  // EN: Revokes the selected refresh session, clears the browser cookie, and returns a stable logout response.
  // UK: Відкликає вибрану refresh-сесію, очищає cookie браузера та повертає стабільну відповідь виходу.
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

  // EN: Starts a password reset without revealing whether the submitted email exists.
  // UK: Запускає відновлення пароля, не розкриваючи існування вказаного email.
  @Post('forgot-password')
  @Throttle({
    default: { limit: 3, ttl: 60_000 },
    principal: { limit: 3, ttl: 60_000 },
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // EN: Consumes a reset token and reports the password-change result.
  // UK: Використовує токен скидання та повертає результат зміни пароля.
  @Post('reset-password')
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    principal: { limit: 5, ttl: 60_000 },
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // EN: Exchanges a mobile OAuth authorization code for the service's login response.
  // UK: Обмінює mobile OAuth-код авторизації на відповідь входу сервісу.
  @Post('oauth/exchange')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async exchangeOAuthCode(@Body() dto: ExchangeOAuthCodeDto) {
    return this.authService.exchangeMobileOAuthCode(dto);
  }

  // EN: Begins MFA enrollment using the short-lived challenge token.
  // UK: Починає підключення MFA за короткоживучим challenge-токеном.
  @Post('mfa/enroll/start')
  @Throttle({
    default: { limit: 5, ttl: 60_000 },
    principal: { limit: 5, ttl: 60_000 },
  })
  beginMfaEnrollment(@Body() dto: MfaChallengeDto) {
    return this.authService.beginMfaEnrollment(dto.challengeToken);
  }

  // EN: Confirms a TOTP enrollment, rejecting an absent code before invoking the service.
  // UK: Підтверджує підключення TOTP і відхиляє відсутній код до виклику сервісу.
  @Post('mfa/enroll/confirm')
  @Throttle({
    default: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
    principal: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
  })
  async confirmMfaEnrollment(
    @Body() dto: MfaVerifyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!dto.code) {
      throw new BadRequestException({ code: 'MFA_TOTP_CODE_REQUIRED' });
    }
    const result = await this.authService.confirmMfaEnrollment(
      dto.challengeToken,
      dto.code,
    );
    return this.deliverSession(response, result, dto.client === 'web');
  }

  // EN: Verifies an MFA challenge and delivers the resulting session according to the client type.
  // UK: Перевіряє MFA challenge та видає сесію відповідно до типу клієнта.
  @Post('mfa/verify')
  @Throttle({
    default: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
    principal: { limit: 5, ttl: 60_000, blockDuration: 300_000 },
  })
  async verifyMfa(
    @Body() dto: MfaVerifyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.verifyMfaChallenge(
      dto.challengeToken,
      { code: dto.code, recoveryCode: dto.recoveryCode },
    );
    return this.deliverSession(response, result, dto.client === 'web');
  }

  // EN: Returns MFA state for the authenticated user identified by JwtGuard.
  // UK: Повертає стан MFA автентифікованого JwtGuard користувача.
  @Get('mfa/status')
  @UseGuards(JwtGuard)
  mfaStatus(@Req() request: Request) {
    return this.authService.getMfaStatus(request.user!.id!);
  }

  // EN: Regenerates recovery codes after the authenticated user proves the current factor.
  // UK: Генерує нові recovery-коди після підтвердження поточного фактора.
  @Post('mfa/recovery/regenerate')
  @UseGuards(JwtGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  regenerateMfaRecoveryCodes(@Req() request: Request, @Body() dto: MfaCodeDto) {
    return this.authService.regenerateMfaRecoveryCodes(
      request.user!.id!,
      dto.code,
    );
  }

  // EN: Disables MFA only after the authenticated user supplies the required code.
  // UK: Вимикає MFA лише після надання автентифікованим користувачем потрібного коду.
  @Post('mfa/disable')
  @UseGuards(JwtGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  disableMfa(@Req() request: Request, @Body() dto: MfaCodeDto) {
    return this.authService.disableMfa(request.user!.id!, dto.code);
  }

  // EN: Revokes every active session and removes the browser's refresh cookie.
  // UK: Відкликає всі активні сесії та видаляє refresh-cookie браузера.
  @Post('logout-all')
  @UseGuards(JwtGuard)
  async logoutAll(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.revokeAllSessions(request.user!.id!);
    response.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
    return result;
  }

  // EN: Lets GoogleAuthGuard initiate the provider redirect; the guard owns the provider handshake.
  // UK: Дозволяє GoogleAuthGuard почати перенаправлення; guard керує взаємодією з провайдером.
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  // EN: Completes Google login, handling web redirects and mobile PKCE code issuance without exposing tokens in URLs.
  // UK: Завершує Google-вхід, обробляє web redirect і видає mobile PKCE-код без токенів у URL.
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(@Req() request: Request, @Res() response: Response) {
    if ((request.user as { cancelled?: boolean })?.cancelled) {
      return this.redirectGoogleError(request, response, 'access_denied');
    }

    const { redirectUrl, codeChallenge } = this.consumeOAuthRequest(request);
    let login: Awaited<ReturnType<AuthService['loginWithGoogle']>>;
    try {
      login = await this.authService.loginWithGoogle(
        request.user as GoogleUser,
      );
    } catch (error) {
      const suspension = this.accountSuspensionFrom(error);
      if (!redirectUrl || !suspension) throw error;
      const url = new URL(redirectUrl);
      const parameters = new URLSearchParams({
        error: 'account_banned',
        expiresAt: suspension.expiresAt,
        reason: suspension.reason ?? '',
      });
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.hash = parameters.toString();
      } else {
        parameters.forEach(
          /* EN: Copies each provider error parameter into custom-scheme URLs, where fragments are unavailable. */
          /* UK: Копіює кожен параметр помилки в URL custom scheme, де fragment недоступний. */
          (value, key) => url.searchParams.set(key, value)
        );
      }
      return response.redirect(url.toString());
    }

    if (!redirectUrl) {
      const result = await this.authService.completePrimaryLogin(
        login.message,
        login.user,
      );
      return response.json(
        'refreshToken' in result
          ? this.deliverSession(response, result, true)
          : result,
      );
    }

    const url = new URL(redirectUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const result = await this.authService.completePrimaryLogin(
        login.message,
        login.user,
      );
      if ('refreshToken' in result) {
        this.setRefreshCookie(response, result.refreshToken);
        url.hash = new URLSearchParams({
          accessToken: result.accessToken,
        }).toString();
      } else {
        url.hash = new URLSearchParams({
          mfaChallenge: result.challengeToken,
          mfaEnrollmentRequired: String(result.enrollmentRequired),
        }).toString();
      }
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

  // EN: Converts a provider denial into a safe redirect or JSON error response.
  // UK: Перетворює відмову провайдера на безпечний redirect або JSON-помилку.
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

  // EN: Extracts only the structured account-suspension payload from a Nest exception.
  // UK: Витягує зі Nest-виключення лише структуровані дані блокування акаунта.
  private accountSuspensionFrom(error: unknown) {
    if (!(error instanceof HttpException)) return null;
    const response = error.getResponse();
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      return null;
    }
    const fields = response as Record<string, unknown>;
    return fields.code === 'ACCOUNT_BANNED' &&
      typeof fields.expiresAt === 'string'
      ? {
          expiresAt: fields.expiresAt,
          reason: typeof fields.reason === 'string' ? fields.reason : null,
        }
      : null;
  }

  // EN: Reads and clears the one-use OAuth redirect metadata attached by the guard.
  // UK: Читає та очищає одноразові OAuth-метадані redirect, додані guard.
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

  // EN: Removes a refresh token from the JSON response when the browser cookie is the transport.
  // UK: Видаляє refresh-токен із JSON-відповіді, коли транспортом є cookie браузера.
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

  // EN: Sets an HTTP-only, same-site refresh cookie with the configured lifetime.
  // UK: Встановлює HTTP-only same-site refresh-cookie з налаштованим строком життя.
  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      this.refreshCookieOptions(REFRESH_TOKEN_TTL_MS),
    );
  }

  // EN: Centralizes cookie flags so login, refresh, and logout use the same security contract.
  // UK: Централізує прапорці cookie, щоб login, refresh і logout мали єдиний контракт безпеки.
  private refreshCookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      maxAge,
      path: '/auth',
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
    };
  }

  // EN: Parses the raw Cookie header and safely decodes the refresh-token value.
  // UK: Розбирає сирий Cookie-заголовок і безпечно декодує значення refresh-токена.
  private readRefreshCookie(request: Request): string | undefined {
    const entry = request.headers.cookie
      ?.split(';')
      .map(
        /* EN: Normalizes cookie segments before selecting the named refresh cookie. */
        /* UK: Нормалізує частини cookie перед вибором потрібного refresh-cookie. */
        (part) => part.trim()
      )
      .find(
        /* EN: Selects only the exact cookie name so similarly prefixed cookies cannot be confused. */
        /* UK: Вибирає лише точну назву cookie, щоб не переплутати схожі префікси. */
        (part) => part.startsWith(`${REFRESH_COOKIE}=`)
      );
    if (!entry) return undefined;
    try {
      return decodeURIComponent(entry.slice(REFRESH_COOKIE.length + 1));
    } catch {
      return undefined;
    }
  }
}
