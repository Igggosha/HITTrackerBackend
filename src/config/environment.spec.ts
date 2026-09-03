import { validateEnvironment } from './environment';

const secureEnvironment = {
  JWT_SECRET: 'a'.repeat(24),
  OAUTH_SESSION_SECRET: 'b'.repeat(24),
};

describe('environment validation', () => {
  it('rejects default and short authentication secrets', () => {
    expect(() => validateEnvironment({ ...secureEnvironment, JWT_SECRET: 'dev-secret' })).toThrow(
      'JWT_SECRET',
    );
    expect(() => validateEnvironment({ ...secureEnvironment, OAUTH_SESSION_SECRET: 'short' })).toThrow(
      'OAUTH_SESSION_SECRET',
    );
  });

  it('requires a CORS allowlist in production', () => {
    expect(() => validateEnvironment({ ...secureEnvironment, NODE_ENV: 'production' })).toThrow(
      'CORS_ORIGINS',
    );
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
      }),
    ).not.toThrow();
  });
});
