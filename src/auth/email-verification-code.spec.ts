import { createEmailVerificationCode } from './email-verification-code';

describe('createEmailVerificationCode', () => {
  it('creates a six-digit code', () => {
    expect(createEmailVerificationCode()).toMatch(/^\d{6}$/);
  });
});
