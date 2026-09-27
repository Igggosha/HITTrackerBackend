/**
 * Transient = worth retrying forever with backoff (the database or the
 * network is temporarily unavailable). Everything else is permanent: it is
 * retried a few times and then dead-lettered, so one poison message cannot
 * block its partition forever, while a database outage never dead-letters
 * perfectly good events.
 */
const TRANSIENT_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// PostgreSQL SQLSTATEs: connection exceptions (class 08), operator
// intervention / shutdown (57P0x), statement timeout (57014), too many
// connections (53300), serialization failure and deadlock (40001, 40P01).
const TRANSIENT_SQLSTATES = new Set([
  '57P01',
  '57P02',
  '57P03',
  '57014',
  '53300',
  '40001',
  '40P01',
]);

const TRANSIENT_MESSAGES = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error',
  'connect ECONNREFUSED',
];

export function isTransientError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') break;
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string') {
      if (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_SQLSTATES.has(code))
        return true;
      if (/^08/.test(code)) return true;
    }
    if (
      typeof message === 'string' &&
      TRANSIENT_MESSAGES.some((fragment) => message.includes(fragment))
    )
      return true;
    current = cause;
  }
  return false;
}

/** Thrown out of a retry loop when the service is shutting down. */
export class ShutdownError extends Error {
  constructor() {
    super('analytics consumer is shutting down');
  }
}

/**
 * A short, payload-free description for logs and DLQ headers. Drizzle's
 * query errors embed the SQL parameters (which can be personal data such as
 * body metrics), so for those only the underlying driver error is described.
 */
export function describeError(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (
      current instanceof Error &&
      current.message.startsWith('Failed query') &&
      current.cause
    ) {
      current = current.cause;
      continue;
    }
    break;
  }
  if (current instanceof Error && current.message.startsWith('Failed query'))
    return `${current.name}: query failed`;
  const text =
    current instanceof Error
      ? `${current.name}: ${current.message}`
      : String(current);
  return text.slice(0, 300);
}
