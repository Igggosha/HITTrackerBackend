// EN: Hashes password-reset bearer tokens so a database leak cannot reveal usable reset links.
// UK: Хешує bearer-токени скидання пароля, щоб витік бази даних не розкрив придатні для використання посилання.

import { createHash } from 'crypto';

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
