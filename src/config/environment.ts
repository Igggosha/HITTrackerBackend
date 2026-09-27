import { validateStorageEnvironment } from '../storage/storage.config';

// 24 random URL-safe characters provide at least 144 bits of entropy.
const SECRET_MINIMUM_LENGTH = 24;
const PLACEHOLDER_SECRETS = new Set([
  'dev-secret',
  'your_jwt_secret_key_here',
  'your_oauth_session_secret_here',
]);

function assertSecret(environment: NodeJS.ProcessEnv, name: string): void {
  const value = environment[name];
  if (
    !value ||
    value.length < SECRET_MINIMUM_LENGTH ||
    PLACEHOLDER_SECRETS.has(value)
  ) {
    throw new Error(
      `${name} must be a unique secret of at least ${SECRET_MINIMUM_LENGTH} characters.`,
    );
  }
}

export function validateEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  assertSecret(environment, 'JWT_SECRET');
  assertSecret(environment, 'OAUTH_SESSION_SECRET');

  const usernameReservationMinutes = Number(
    environment.USERNAME_RESERVATION_MINUTES ?? 25,
  );
  if (
    !Number.isInteger(usernameReservationMinutes) ||
    usernameReservationMinutes < 1 ||
    usernameReservationMinutes > 1440
  ) {
    throw new Error(
      'USERNAME_RESERVATION_MINUTES must be an integer between 1 and 1440.',
    );
  }

  if (
    environment.NODE_ENV === 'production' &&
    !environment.CORS_ORIGINS?.trim()
  ) {
    throw new Error('CORS_ORIGINS is required in production.');
  }

  if (environment.DATABASE_REPLICA_URL) {
    try {
      const replicaUrl = new URL(environment.DATABASE_REPLICA_URL);
      if (
        !['postgres:', 'postgresql:'].includes(replicaUrl.protocol) ||
        !replicaUrl.hostname ||
        !replicaUrl.pathname.slice(1)
      ) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'DATABASE_REPLICA_URL must be a PostgreSQL connection URL.',
      );
    }
  }

  // Object storage is optional, but a partially configured one must not boot.
  validateStorageEnvironment(environment);

  // Shared with the standalone relay bootstrap (`src/relay/main.ts`), which
  // has no ConfigModule of its own and must fail fast the same way.
  validateRelayEnvironment(environment);

  return environment;
}

function assertOptionalIntInRange(
  environment: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum?: number,
): void {
  const raw = environment[name];
  if (raw === undefined) return;
  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      maximum === undefined
        ? `${name} must be an integer of at least ${minimum}.`
        : `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

/**
 * Validates the relay's own tuning variables. Every one of them is optional
 * (the relay falls back to a safe default), so this only rejects a value that
 * was set but is out of range - it never requires KAFKA_BROKERS, which stays
 * unset for hosts that never run the relay.
 */
export function validateRelayEnvironment(environment: NodeJS.ProcessEnv): void {
  assertOptionalIntInRange(environment, 'RELAY_POLL_INTERVAL_MS', 100);
  assertOptionalIntInRange(environment, 'RELAY_PUBLISH_TIMEOUT_MS', 100);
  assertOptionalIntInRange(environment, 'RELAY_CONNECTION_TIMEOUT_MS', 100);
  assertOptionalIntInRange(environment, 'RELAY_DB_TX_TIMEOUT_MS', 1000);
  assertOptionalIntInRange(environment, 'RELAY_METRICS_PORT', 1, 65535);
}
