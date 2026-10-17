// EN: Verifies reversible authenticated encryption of push tokens without exposing plaintext in persisted ciphertext.
// UK: Перевіряє зворотне автентифіковане шифрування push-токенів без розкриття відкритого тексту в збереженому шифротексті.

import {
  decryptPushToken,
  encryptPushToken,
  hashPushToken,
} from './push-token.crypto';

describe('push token protection', () => {
  it('encrypts reversibly without exposing the token', () => {
    const token = 'provider-token';
    const ciphertext = encryptPushToken(token, 'private-key-material');
    expect(ciphertext).not.toContain(token);
    expect(decryptPushToken(ciphertext, 'private-key-material')).toBe(token);
    expect(hashPushToken(token)).toHaveLength(64);
  });
});
