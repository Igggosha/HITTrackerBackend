// EN: Verifies PKCE verifier binding and irreversible hashing of single-use mobile OAuth authorization codes.
// UK: Перевіряє прив'язування PKCE verifier і незворотне хешування одноразових кодів авторизації mobile OAuth.

import { createPkceChallenge, hashOAuthCode, verifyPkce } from './oauth-pkce';

describe('OAuth PKCE', () => {
  const verifier =
    'a-very-long-pkce-verifier-that-is-safe-and-random-1234567890';

  it('only accepts the verifier that created the challenge', () => {
    const challenge = createPkceChallenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
  });

  it('hashes one-time authorization codes before persistence', () => {
    expect(hashOAuthCode('raw-code')).not.toBe('raw-code');
    expect(hashOAuthCode('raw-code')).toHaveLength(64);
  });
});
