import {
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  parseTotpEncryptionKeys,
} from './mfa-crypto';

describe('MFA secret protection', () => {
  const first = Buffer.alloc(32, 1).toString('base64');
  const second = Buffer.alloc(32, 2).toString('base64');

  it('encrypts with the current key and decrypts after key rotation', () => {
    const oldKeys = parseTotpEncryptionKeys(second);
    const encrypted = encryptTotpSecret('BASE32SECRET', oldKeys);
    const rotated = parseTotpEncryptionKeys(`${first},${second}`);

    expect(encrypted).not.toContain('BASE32SECRET');
    expect(decryptTotpSecret(encrypted, rotated)).toBe('BASE32SECRET');
  });

  it('rejects malformed keys and ciphertext', () => {
    expect(() => parseTotpEncryptionKeys('short')).toThrow(
      'base64-encoded 32-byte keys',
    );
    expect(() =>
      decryptTotpSecret('v1.unknown.a.b.c', parseTotpEncryptionKeys(first)),
    ).toThrow('unavailable');
  });

  it('creates high-entropy one-time recovery codes and stable hashes', () => {
    const codes = createRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(hashRecoveryCode(codes[0])).toBe(
      hashRecoveryCode(codes[0].toLowerCase().replaceAll('-', ' ')),
    );
  });
});
