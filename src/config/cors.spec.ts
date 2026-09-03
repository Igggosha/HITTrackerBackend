import { getAllowedCorsOrigins, isCorsOriginAllowed } from './cors';

describe('CORS origin allowlist', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('uses the explicit production allowlist and rejects unlisted origins', () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
    };

    expect(getAllowedCorsOrigins()).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
    expect(isCorsOriginAllowed('https://app.example.com')).toBe(true);
    expect(isCorsOriginAllowed('https://attacker.example')).toBe(false);
  });

  it('does not allow browser origins when production has no allowlist', () => {
    process.env = { ...originalEnvironment, NODE_ENV: 'production' };
    delete process.env.CORS_ORIGINS;

    expect(isCorsOriginAllowed('https://attacker.example')).toBe(false);
    expect(isCorsOriginAllowed(undefined)).toBe(true);
  });
});
