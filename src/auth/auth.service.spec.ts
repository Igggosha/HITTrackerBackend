import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';
import { db } from '../db/db';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/auth.dto';

const mockLimit = jest.fn();
const mockUpdateWhere = jest.fn();
const mockInsertValues = jest.fn();
const mockOnConflictDoUpdate = jest.fn();
const mockTxLimit = jest.fn();
const mockTxReturning = jest.fn();
const mockTxDeleteWhere = jest.fn();
const mockTxInsertValues = jest.fn();
const mockTxUpdateReturning = jest.fn();
const tx = {
  select: jest.fn(() => ({
    from: () => ({ where: () => ({ limit: mockTxLimit }) }),
  })),
  insert: jest.fn(() => ({
    values: mockTxInsertValues,
  })),
  update: jest.fn(() => ({
    set: () => ({
      where: () => ({ returning: mockTxUpdateReturning }),
    }),
  })),
  delete: jest.fn(() => ({ where: mockTxDeleteWhere })),
};

jest.mock('../db/db', () => ({
  db: {
    select: jest.fn(() => ({
      from: () => ({ where: () => ({ limit: mockLimit }) }),
    })),
    delete: jest.fn(() => ({ where: jest.fn() })),
    update: jest.fn(() => ({ set: () => ({ where: mockUpdateWhere }) })),
    insert: jest.fn(() => ({ values: mockInsertValues })),
    transaction: jest.fn(),
  },
}));

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

describe('AuthService registration', () => {
  const jwtService = { sign: jest.fn(() => 'access-token') };
  const mailerService = { sendMail: jest.fn() };
  const service = new AuthService(
    jwtService as any,
    mailerService as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockLimit.mockReset();
    mockUpdateWhere.mockReset();
    mockInsertValues.mockReset();
    mockOnConflictDoUpdate.mockReset();
    mockTxLimit.mockReset();
    mockTxReturning.mockReset();
    mockTxDeleteWhere.mockReset();
    mockTxInsertValues.mockReset();
    mockTxInsertValues.mockReturnValue({ returning: mockTxReturning });
    mockTxUpdateReturning.mockReset();
    (db.transaction as jest.Mock).mockImplementation((callback) =>
      callback(tx),
    );
    mockInsertValues.mockReturnValue({
      onConflictDoUpdate: mockOnConflictDoUpdate,
    });
  });

  it('accepts a legacy payload without fullName', async () => {
    const dto = Object.assign(new RegisterDto(), {
      email: 'legacy@example.com',
      password: 'password123',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('AUTH-REG-003 accepts a legacy client and derives only a display name', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (bcrypt.hash as jest.Mock)
      .mockResolvedValueOnce('password-hash')
      .mockResolvedValueOnce('verification-code-hash');
    mockOnConflictDoUpdate.mockResolvedValue(undefined);

    await service.register({
      email: ' Legacy@Example.com ',
      password: 'password123',
    });

    const registration = mockInsertValues.mock.calls[0][0];
    expect(registration).toEqual(
      expect.objectContaining({
        email: 'legacy@example.com',
        displayName: 'legacy',
      }),
    );
    expect(registration).not.toHaveProperty('username');
  });

  it('AUTH-REG-001 keeps the display name separate from profile username', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (bcrypt.hash as jest.Mock)
      .mockResolvedValueOnce('password-hash')
      .mockResolvedValueOnce('verification-code-hash');

    await service.register({
      displayName: 'Bohdan',
      email: 'bohdan@example.com',
      password: 'Password1',
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Bohdan',
      }),
    );
    expect(mockInsertValues.mock.calls[0][0]).not.toHaveProperty('username');
  });

  it('AUTH-VERIFY-004 identifies an expired code', async () => {
    mockLimit.mockResolvedValue([
      { email: 'user@example.com', expiresAt: new Date(0), lockedUntil: null },
    ]);

    await expect(
      service.verifyRegistration({ email: 'user@example.com', code: '123456' }),
    ).rejects.toMatchObject({
      response: { code: 'VERIFICATION_CODE_EXPIRED' },
      status: 410,
    });
  });

  it('AUTH-VERIFY-002 identifies an incorrect code', async () => {
    mockLimit.mockResolvedValue([
      {
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 60_000),
        lockedUntil: null,
        attempts: 0,
        verificationCodeHash: 'hash',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.verifyRegistration({ email: 'user@example.com', code: '123456' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_VERIFICATION_CODE' },
      status: 400,
    });
  });

  it('AUTH-VERIFY-003 maps a concurrent account creation to a stable conflict', async () => {
    mockLimit.mockResolvedValue([
      {
        email: 'user@example.com',
        displayName: 'Same Name',
        passwordHash: 'password-hash',
        expiresAt: new Date(Date.now() + 60_000),
        lockedUntil: null,
        attempts: 0,
        verificationCodeHash: 'verification-code-hash',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (db.transaction as jest.Mock).mockRejectedValue({
      code: '23505',
      constraint: 'users_username_key',
    });

    await expect(
      service.verifyRegistration({ email: 'user@example.com', code: '123456' }),
    ).rejects.toMatchObject({
      response: { code: 'USER_ALREADY_EXISTS' },
      status: 409,
    });
  });

  it('AUTH-VERIFY-001 creates an account only after a valid code', async () => {
    const pending = {
      email: 'user@example.com',
      displayName: 'User',
      passwordHash: 'password-hash',
      expiresAt: new Date(Date.now() + 60_000),
      lockedUntil: null,
      attempts: 0,
      verificationCodeHash: 'verification-code-hash',
    };
    mockLimit.mockResolvedValueOnce([pending]);
    mockTxLimit.mockResolvedValueOnce([]);
    mockTxReturning.mockResolvedValueOnce([{ id: 1 }]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.verifyRegistration({ email: pending.email, code: '123456' }),
    ).resolves.toEqual({ message: 'Registration successful' });
    expect(tx.insert).toHaveBeenCalled();
    expect(mockTxReturning).toHaveBeenCalled();
    expect(mockTxDeleteWhere).toHaveBeenCalled();
  });

  it('AUTH-LOGIN-001 returns an auth response for valid credentials', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 1,
        email: 'user@example.com',
        username: null,
        displayName: 'User',
        passwordHash: 'password-hash',
        role: 'user',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.login({
      email: 'user@example.com',
      password: 'Password1',
    });

    expect(result).toMatchObject({
      accessToken: 'access-token',
      user: { email: 'user@example.com', username: null },
    });
    expect(result.refreshToken).toHaveLength(64);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(mockInsertValues.mock.calls[0][0].tokenHash).not.toBe(
      result.refreshToken,
    );
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 1, email: 'user@example.com', role: 'user' },
      { expiresIn: '5m' },
    );
  });

  it('rotates a refresh session and reloads the current database role', async () => {
    mockTxUpdateReturning.mockResolvedValueOnce([{ id: 7, userId: 1 }]);
    mockTxLimit.mockResolvedValueOnce([
      {
        id: 1,
        email: 'user@example.com',
        username: null,
        displayName: 'User',
        role: 'moderator',
      },
    ]);

    const result = await service.refreshSession('r'.repeat(64));

    expect(result.user.role).toBe('moderator');
    expect(result.refreshToken).toHaveLength(64);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 1, email: 'user@example.com', role: 'moderator' },
      { expiresIn: '5m' },
    );
  });

  it('rejects an expired or already consumed refresh session', async () => {
    mockTxUpdateReturning.mockResolvedValueOnce([]);

    await expect(service.refreshSession('r'.repeat(64))).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
      status: 401,
    });
  });

  it('AUTH-LOGIN-002 returns the stable unknown-user code', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      service.validateUser('missing@example.com', 'Password1'),
    ).rejects.toMatchObject({
      response: { code: 'USER_NOT_FOUND' },
      status: 404,
    });
  });

  it('AUTH-LOGIN-003 returns a distinct wrong-password code', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 1,
        email: 'user@example.com',
        passwordHash: 'password-hash',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.validateUser('user@example.com', 'wrong'),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS' },
      status: 401,
    });
  });

  it('AUTH-LOGIN-007 does not classify a pending registration as unknown', async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ email: 'pending@example.com' }]);

    await expect(
      service.validateUser('pending@example.com', 'Password1'),
    ).rejects.toMatchObject({
      response: { code: 'EMAIL_NOT_VERIFIED' },
      status: 403,
    });
  });
});
