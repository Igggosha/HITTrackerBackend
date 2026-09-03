import { hashPasswordResetToken } from './password-reset-token';

describe('password reset token hashing', () => {
  it('creates a deterministic non-reversible database value', () => {
    const token = 'a-raw-reset-token';
    const digest = hashPasswordResetToken(token);

    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(hashPasswordResetToken(token)).toBe(digest);
    expect(hashPasswordResetToken('another-token')).not.toBe(digest);
  });
});
