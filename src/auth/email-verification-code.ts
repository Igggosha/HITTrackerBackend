// EN: Generates a cryptographically random six-digit code for one-time email registration verification.
// UK: Створює криптографічно випадковий шестизначний код для одноразового підтвердження реєстрації через електронну пошту.

import * as crypto from 'crypto';

export function createEmailVerificationCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}
