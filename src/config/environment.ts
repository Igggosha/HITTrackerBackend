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

  return environment;
}
