import * as crypto from 'crypto';

export function createEmailVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
