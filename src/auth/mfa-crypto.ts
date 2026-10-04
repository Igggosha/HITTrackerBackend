import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export type TotpEncryptionKey = { id: string; value: Buffer };

export function parseTotpEncryptionKeys(raw: string): TotpEncryptionKey[] {
  const keys = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const value = Buffer.from(entry, 'base64');
      if (value.length !== 32) {
        throw new Error(
          'TOTP_ENCRYPTION_KEYS entries must be base64-encoded 32-byte keys.',
        );
      }
      return {
        id: createHash('sha256').update(value).digest('hex').slice(0, 12),
        value,
      };
    });
  if (!keys.length) throw new Error('TOTP_ENCRYPTION_KEYS is required.');
  if (new Set(keys.map((key) => key.id)).size !== keys.length) {
    throw new Error('TOTP_ENCRYPTION_KEYS contains a duplicate key.');
  }
  return keys;
}

export function encryptTotpSecret(
  secret: string,
  keys: readonly TotpEncryptionKey[],
): string {
  const current = keys[0];
  if (!current) throw new Error('A TOTP encryption key is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.value, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    current.id,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptTotpSecret(
  encrypted: string,
  keys: readonly TotpEncryptionKey[],
): string {
  const [version, keyId, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== 'v1' || !keyId || !iv || !tag || !ciphertext) {
    throw new Error('Invalid encrypted TOTP secret.');
  }
  const key = keys.find((candidate) => candidate.id === keyId);
  if (!key) throw new Error('TOTP encryption key is unavailable.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key.value,
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(10).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function hashMfaChallenge(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
