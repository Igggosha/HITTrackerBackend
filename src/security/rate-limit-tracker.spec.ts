import {
  ipRateLimitTracker,
  principalRateLimitTracker,
} from './rate-limit-tracker';

describe('rate limit trackers', () => {
  it('keeps IP and normalized account counters independent', () => {
    const request = {
      ip: '203.0.113.8',
      body: { email: ' User@Example.com ' },
      headers: {},
      socket: {},
    } as any;
    expect(ipRateLimitTracker(request)).toBe('ip:203.0.113.8');
    expect(principalRateLimitTracker(request)).toMatch(/^email:[a-f0-9]{64}$/);
    expect(principalRateLimitTracker(request)).not.toContain('example.com');
  });

  it('uses current database-backed user identity when available', () => {
    expect(
      principalRateLimitTracker({ user: { id: 42 }, headers: {} } as any),
    ).toBe('user:42');
  });

  it('hashes native and cookie refresh credentials', () => {
    const body = principalRateLimitTracker({
      body: { refreshToken: 'secret-refresh-token' },
      headers: {},
    } as any);
    const cookie = principalRateLimitTracker({
      body: {},
      headers: { cookie: 'hit_tracker_refresh=secret-refresh-token' },
    } as any);
    expect(body).toBe(cookie);
    expect(body).not.toContain('secret-refresh-token');
  });
});
