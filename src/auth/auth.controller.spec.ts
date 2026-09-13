import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    createSession: jest.fn(),
    issueMobileOAuthCode: jest.fn(),
    login: jest.fn(),
    loginWithGoogle: jest.fn(),
    refreshSession: jest.fn(),
    revokeRefreshSession: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('keeps the web refresh token in an HttpOnly cookie', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 1, role: 'user' },
    });
    const response = { cookie: jest.fn() } as any;

    const result = await controller.login(
      { email: 'user@example.com', password: 'Password1', client: 'web' },
      response,
    );

    expect(result).not.toHaveProperty('refreshToken');
    expect(response.cookie).toHaveBeenCalledWith(
      'hit_tracker_refresh',
      'refresh',
      expect.objectContaining({ httpOnly: true, path: '/auth' }),
    );
  });

  it('does not create a refresh session before the native PKCE exchange', async () => {
    process.env.OAUTH_MOBILE_REDIRECT_URL =
      'hit-tracker-mobile://auth/google/callback';
    authService.loginWithGoogle.mockResolvedValue({
      message: 'Google login successful',
      user: { id: 1, role: 'user' },
    });
    authService.issueMobileOAuthCode.mockResolvedValue('one-time-code');
    const request = {
      session: {
        oauthCodeChallenge: 'challenge',
        oauthPlatform: 'mobile',
      },
      user: { email: 'user@example.com', googleId: 'google-id' },
    } as any;
    const response = { redirect: jest.fn() } as any;

    await controller.googleAuthCallback(request, response);

    expect(authService.createSession).not.toHaveBeenCalled();
    expect(authService.issueMobileOAuthCode).toHaveBeenCalledWith(
      { id: 1, role: 'user' },
      'challenge',
    );
    expect(response.redirect).toHaveBeenCalledWith(
      expect.stringContaining('code=one-time-code'),
    );
  });
});
