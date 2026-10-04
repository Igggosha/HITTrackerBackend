import { validateEnvironment, validateRelayEnvironment } from './environment';

const secureEnvironment = {
  JWT_SECRET: 'a'.repeat(24),
  OAUTH_SESSION_SECRET: 'b'.repeat(24),
  TOTP_ENCRYPTION_KEYS: Buffer.alloc(32, 7).toString('base64'),
  REDIS_URL: 'redis://:password@redis:6379',
};

describe('environment validation', () => {
  it('rejects default and short authentication secrets', () => {
    expect(() =>
      validateEnvironment({ ...secureEnvironment, JWT_SECRET: 'dev-secret' }),
    ).toThrow('JWT_SECRET');
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        OAUTH_SESSION_SECRET: 'short',
      }),
    ).toThrow('OAUTH_SESSION_SECRET');
  });

  it('requires a CORS allowlist in production', () => {
    expect(() =>
      validateEnvironment({ ...secureEnvironment, NODE_ENV: 'production' }),
    ).toThrow('CORS_ORIGINS');
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
      }),
    ).not.toThrow();
  });

  it('requires distributed throttling and TOTP encryption in production', () => {
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        REDIS_URL: '',
      }),
    ).toThrow('REDIS_URL');
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        TOTP_ENCRYPTION_KEYS: 'invalid',
      }),
    ).toThrow('TOTP_ENCRYPTION_KEYS');
  });

  it('validates the private username reservation duration', () => {
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        USERNAME_RESERVATION_MINUTES: '0',
      }),
    ).toThrow('USERNAME_RESERVATION_MINUTES');
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        USERNAME_RESERVATION_MINUTES: '25',
      }),
    ).not.toThrow();
  });

  it('accepts an optional PostgreSQL replica URL and rejects invalid values', () => {
    expect(() => validateEnvironment(secureEnvironment)).not.toThrow();
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        DATABASE_REPLICA_URL: 'postgresql://user:pass@replica:5432/app',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        DATABASE_REPLICA_URL: 'https://replica/app',
      }),
    ).toThrow('DATABASE_REPLICA_URL');
  });

  it('rejects an out-of-range relay poll interval and accepts a valid one', () => {
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        RELAY_POLL_INTERVAL_MS: '10',
      }),
    ).toThrow('RELAY_POLL_INTERVAL_MS');
    expect(() =>
      validateEnvironment({
        ...secureEnvironment,
        RELAY_POLL_INTERVAL_MS: '500',
        RELAY_FALLBACK_POLL_INTERVAL_MS: '5000',
      }),
    ).not.toThrow();
  });
});

describe('validateRelayEnvironment', () => {
  it('leaves every optional relay variable unset alone', () => {
    expect(() => validateRelayEnvironment({})).not.toThrow();
  });

  it('accepts values in range for every relay tuning variable', () => {
    expect(() =>
      validateRelayEnvironment({
        RELAY_POLL_INTERVAL_MS: '500',
        RELAY_FALLBACK_POLL_INTERVAL_MS: '5000',
        RELAY_PUBLISH_TIMEOUT_MS: '5000',
        RELAY_CONNECTION_TIMEOUT_MS: '5000',
        RELAY_DB_TX_TIMEOUT_MS: '10000',
        RELAY_METRICS_PORT: '9464',
      }),
    ).not.toThrow();
  });

  it('rejects a non-integer or out-of-range value for each variable', () => {
    expect(() =>
      validateRelayEnvironment({ RELAY_PUBLISH_TIMEOUT_MS: '99' }),
    ).toThrow('RELAY_PUBLISH_TIMEOUT_MS');
    expect(() =>
      validateRelayEnvironment({ RELAY_FALLBACK_POLL_INTERVAL_MS: '99' }),
    ).toThrow('RELAY_FALLBACK_POLL_INTERVAL_MS');
    expect(() =>
      validateRelayEnvironment({ RELAY_CONNECTION_TIMEOUT_MS: 'abc' }),
    ).toThrow('RELAY_CONNECTION_TIMEOUT_MS');
    expect(() =>
      validateRelayEnvironment({ RELAY_DB_TX_TIMEOUT_MS: '999' }),
    ).toThrow('RELAY_DB_TX_TIMEOUT_MS');
    expect(() =>
      validateRelayEnvironment({ RELAY_METRICS_PORT: '70000' }),
    ).toThrow('RELAY_METRICS_PORT');
    expect(() => validateRelayEnvironment({ RELAY_METRICS_PORT: '0' })).toThrow(
      'RELAY_METRICS_PORT',
    );
  });
});
