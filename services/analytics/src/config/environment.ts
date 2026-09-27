const SECRET_MINIMUM_LENGTH = 24;
const PLACEHOLDERS = new Set([
  'change_me',
  'dev-secret',
  'your_jwt_secret_key_here',
]);

export type AnalyticsConfig = {
  port: number;
  databaseUrl: string;
  kafkaBrokers: string[];
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
};

function intInRange(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

/** Fails fast at boot, like the main API's `validateEnvironment`. */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsConfig {
  const secret = env.JWT_SECRET;
  if (
    !secret ||
    secret.length < SECRET_MINIMUM_LENGTH ||
    PLACEHOLDERS.has(secret)
  )
    throw new Error(
      `JWT_SECRET must be the main API's secret (at least ${SECRET_MINIMUM_LENGTH} characters).`,
    );
  const databaseUrl = env.ANALYTICS_DATABASE_URL;
  try {
    const url = new URL(databaseUrl ?? '');
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error(
      'ANALYTICS_DATABASE_URL must be a PostgreSQL connection URL.',
    );
  }
  return {
    port: intInRange(env, 'PORT', 3000, 1, 65535),
    databaseUrl: databaseUrl!,
    kafkaBrokers: (env.KAFKA_BROKERS ?? '')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean),
    maxAttempts: intInRange(env, 'ANALYTICS_MAX_ATTEMPTS', 5, 1, 100),
    retryBaseMs: intInRange(env, 'ANALYTICS_RETRY_BASE_MS', 200, 1, 60_000),
    retryMaxMs: intInRange(env, 'ANALYTICS_RETRY_MAX_MS', 30_000, 1, 600_000),
  };
}
