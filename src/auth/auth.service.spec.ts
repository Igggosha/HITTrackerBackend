import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

const mockLimit = jest.fn();
const mockUpdateWhere = jest.fn();

jest.mock('../db/db', () => ({
  db: {
    select: jest.fn(() => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) })),
    delete: jest.fn(() => ({ where: jest.fn() })),
    update: jest.fn(() => ({ set: () => ({ where: mockUpdateWhere }) })),
  },
}));

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

describe('AuthService verification errors', () => {
  const service = new AuthService({} as any, {} as any, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('identifies an expired code', async () => {
    mockLimit.mockResolvedValue([{ email: 'user@example.com', expiresAt: new Date(0), lockedUntil: null }]);

    await expect(service.verifyRegistration({ email: 'user@example.com', code: '123456' }))
      .rejects.toMatchObject({ response: { code: 'VERIFICATION_CODE_EXPIRED' }, status: 410 });
  });

  it('identifies an incorrect code', async () => {
    mockLimit.mockResolvedValue([{
      email: 'user@example.com',
      expiresAt: new Date(Date.now() + 60_000),
      lockedUntil: null,
      attempts: 0,
      verificationCodeHash: 'hash',
    }]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.verifyRegistration({ email: 'user@example.com', code: '123456' }))
      .rejects.toMatchObject({ response: { code: 'INVALID_VERIFICATION_CODE' }, status: 400 });
  });
});
