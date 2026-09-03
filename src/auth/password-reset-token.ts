import { createHash } from 'crypto';

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
