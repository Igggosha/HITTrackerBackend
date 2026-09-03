import { createHash, timingSafeEqual } from 'crypto';

export function hashOAuthCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function createPkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifyPkce(verifier: string, expectedChallenge: string): boolean {
  const actual = Buffer.from(createPkceChallenge(verifier));
  const expected = Buffer.from(expectedChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
