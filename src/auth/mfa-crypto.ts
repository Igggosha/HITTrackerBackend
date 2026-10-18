// EN: Encrypts TOTP secrets with versioned AES-GCM keys and creates normalized one-time recovery and challenge hashes.
// UK: Шифрує секрети TOTP версіонованими ключами AES-GCM і створює нормалізовані одноразові recovery-коди та хеші challenge.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export type TotpEncryptionKey = { id: string; value: Buffer };

// EN: Parses the ordered key ring, validates each AES-256 key, and derives stable non-secret identifiers used in encrypted payloads.
// UK: Розбирає впорядкований key ring, перевіряє кожен AES-256 ключ і створює стабільні несекретні ідентифікатори для encrypted payload.
export function parseTotpEncryptionKeys(raw: string): TotpEncryptionKey[] {
  const keys = raw
    .split(',')
    .map(
      /* EN: Removes configuration whitespace before decoding each key. */
      /* UK: Прибирає пробіли конфігурації перед декодуванням кожного ключа. */
      (entry) => entry.trim(),
    )
    .filter(
      /* EN: Ignores empty comma-separated entries without weakening key validation. */
      /* UK: Ігнорує порожні елементи між комами, не послаблюючи перевірку ключів. */
      Boolean,
    )
    .map(
      /* EN: Decodes one key, enforces the 32-byte AES-256 length, and assigns its fingerprint. */
      /* UK: Декодує один ключ, вимагає 32 байти для AES-256 і призначає його fingerprint. */
      (entry) => {
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
      },
    );
  if (!keys.length) throw new Error('TOTP_ENCRYPTION_KEYS is required.');
  if (
    new Set(
      keys.map(
        /* EN: Extracts fingerprints so duplicate physical keys can be rejected. */
        /* UK: Витягує fingerprints, щоб відхилити повторення однакових фізичних ключів. */
        (key) => key.id,
      ),
    ).size !== keys.length
  ) {
    throw new Error('TOTP_ENCRYPTION_KEYS contains a duplicate key.');
  }
  return keys;
}

// EN: Encrypts a TOTP seed with the first (current) key using a fresh IV and stores version, key id, authentication tag, and ciphertext together.
// UK: Шифрує TOTP seed першим (активним) ключем зі свіжим IV та зберігає разом version, key id, authentication tag і ciphertext.
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

// EN: Validates the versioned envelope, selects its historical key, and lets AES-GCM reject altered ciphertext or metadata.
// UK: Перевіряє versioned envelope, вибирає його історичний ключ і дозволяє AES-GCM відхилити змінені ciphertext або metadata.
export function decryptTotpSecret(
  encrypted: string,
  keys: readonly TotpEncryptionKey[],
): string {
  const [version, keyId, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== 'v1' || !keyId || !iv || !tag || !ciphertext) {
    throw new Error('Invalid encrypted TOTP secret.');
  }
  const key = keys.find(
    /* EN: Locates the exact historical key named by the encrypted envelope. */
    /* UK: Знаходить точний історичний ключ, указаний у зашифрованому envelope. */
    (candidate) => candidate.id === keyId,
  );
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

// EN: Reports whether a stored secret already uses the active key so callers can re-encrypt old records during normal use.
// UK: Визначає, чи запис уже використовує активний ключ, щоб caller міг перешифрувати старий secret під час звичайної роботи.
export function isTotpSecretEncryptedWithCurrentKey(
  encrypted: string,
  keys: readonly TotpEncryptionKey[],
): boolean {
  const current = keys[0];
  if (!current) throw new Error('A TOTP encryption key is required.');
  return encrypted.split('.')[1] === current.id;
}

// EN: Produces the requested number of human-readable, cryptographically random one-time recovery codes.
// UK: Створює потрібну кількість зручних для читання криптографічно випадкових одноразових recovery-кодів.
export function createRecoveryCodes(count = 10): string[] {
  return Array.from(
    { length: count },
    /* EN: Generates and groups one independent 80-bit code for display to the user. */
    /* UK: Генерує та групує один незалежний 80-бітний код для показу користувачу. */
    () => {
      const raw = randomBytes(10).toString('hex').toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`;
    },
  );
}

// EN: Removes presentation separators and normalizes case so typed recovery codes compare consistently.
// UK: Прибирає візуальні роздільники й нормалізує регістр, щоб введені recovery-коди порівнювалися однаково.
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// EN: Hashes the normalized recovery code so the database never needs to store the usable plaintext value.
// UK: Хешує нормалізований recovery-код, щоб база даних не зберігала придатне до використання відкрите значення.
export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// EN: Creates the lookup hash for a short-lived MFA challenge while keeping the bearer token itself out of storage.
// UK: Створює lookup hash для короткоживучого MFA challenge, не зберігаючи сам bearer token.
export function hashMfaChallenge(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
