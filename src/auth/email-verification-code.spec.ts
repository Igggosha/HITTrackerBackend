// EN: Verifies that generated email-verification codes always use the expected six-digit format.
// UK: Перевіряє, що створені коди підтвердження електронної пошти завжди мають очікуваний шестизначний формат.

import { createEmailVerificationCode } from './email-verification-code';

describe('createEmailVerificationCode', () => {
  it('creates a six-digit code', () => {
    expect(createEmailVerificationCode()).toMatch(/^\d{6}$/);
  });
});
