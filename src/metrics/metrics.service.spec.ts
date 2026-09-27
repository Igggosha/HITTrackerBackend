import { MetricsService } from './metrics.service';

describe('MetricsService authorization', () => {
  const originalToken = process.env.METRICS_TOKEN;
  const service = new MetricsService();

  afterAll(() => {
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
  });

  it('denies missing, placeholder, and incorrect tokens', () => {
    delete process.env.METRICS_TOKEN;
    expect(service.authorized('Bearer anything')).toBe(false);
    process.env.METRICS_TOKEN = 'change_me';
    expect(service.authorized('Bearer change_me')).toBe(false);
    process.env.METRICS_TOKEN = 'a'.repeat(24);
    expect(service.authorized(`Bearer ${'b'.repeat(24)}`)).toBe(false);
  });

  it('accepts the configured bearer token', () => {
    process.env.METRICS_TOKEN = 'a'.repeat(24);
    expect(service.authorized(`Bearer ${'a'.repeat(24)}`)).toBe(true);
  });
});
