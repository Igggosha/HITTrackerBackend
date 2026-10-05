import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';
import { db } from '../db/db';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/auth.dto';
import { OutboxService } from '../outbox/outbox.service';

jest.mock('./mfa.service', () => ({ MfaService: class MfaService {} }));

const mockLimit = jest.fn();
const mockUpdateWhere = jest.fn();
const mockInsertValues = jest.fn();
const mockOnConflictDoUpdate = jest.fn();
const mockTxLimit = jest.fn();
const mockTxReturning = jest.fn();
const mockTxDeleteWhere = jest.fn();
const mockTxInsertValues = jest.fn();
const mockTxUpdateReturning = jest.fn();
const mockTxFor = jest.fn(() => ({ limit: mockTxLimit }));
const mockUpsertReturning = jest.fn();
const tx = {
  rollback: jest.fn(),
  execute: jest.fn(),
  select: jest.fn(() => ({
    from: () => ({ where: () => ({ limit: mockTxLimit, for: mockTxFor }) }),
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

jest.mock('../db/db', () => {
  const db = {
    select: jest.fn(() => {
      throw new Error('Auth read used the replica');
    }),
    delete: jest.fn(() => ({ where: jest.fn() })),
    update: jest.fn(() => ({ set: () => ({ where: mockUpdateWhere }) })),
    insert: jest.fn(() => ({ values: mockInsertValues })),
    transaction: jest.fn(),
  };
  return {
    db,
    primaryDb: {
      select: jest.fn(() => ({
        from: () => ({ where: () => ({ limit: mockLimit }) }),
      })),
    },
  };
});

jest.mock('bcrypt', () => ({ compare: jest.fn(), hash: jest.fn() }));

describe('AuthService registration', () => {
  const jwtService = { sign: jest.fn(() => 'access-token') };
  const mailerService = { sendMail: jest.fn() };
  const service = new AuthService(
    jwtService as any,
    mailerService as any,
    {} as any,
    new OutboxService(),
    { prepareLogin: jest.fn().mockResolvedValue(null) } as any,
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
    mockUpsertReturning.mockReset();
    mockUpsertReturning.mockResolvedValue([{ email: 'stored@example.com' }]);
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockUpsertReturning });
  });

  it('accepts a legacy payload without fullName', async () => {
    const dto = Object.assign(new RegisterDto(), {
      email: 'legacy@example.com',
      password: 'password1234',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('AUTH-REG-003 accepts a legacy client and derives only a display name', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (bcrypt.hash as jest.Mock)
      .mockResolvedValueOnce('password-hash')
      .mockResolvedValueOnce('verification-code-hash');
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
    mockTxLimit.mockResolvedValueOnce([
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
    mockTxLimit.mockResolvedValueOnce([
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
    mockTxLimit.mockResolvedValueOnce([pending]).mockResolvedValueOnce([]);
    mockTxReturning.mockResolvedValueOnce([
      { id: 1, createdAt: new Date('2026-09-27T10:00:00Z') },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(
      service.verifyRegistration({ email: pending.email, code: '123456' }),
    ).resolves.toEqual({ message: 'Registration successful' });
    expect(tx.insert).toHaveBeenCalled();
    expect(mockTxReturning).toHaveBeenCalled();
    expect(mockTxDeleteWhere).toHaveBeenCalled();
    expect(mockTxInsertValues).toHaveBeenLastCalledWith({
      aggregateType: 'user',
      aggregateId: '1',
      eventType: 'user.registered',
      eventVersion: 1,
      payload: {
        userId: 1,
        method: 'email',
        registeredAt: '2026-09-27T10:00:00.000Z',
      },
    });
  });

  it('AUTH-VERIFY-005 locks the pending row and commits a failed attempt', async () => {
    mockTxLimit.mockResolvedValueOnce([
      {
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 60_000),
        lockedUntil: null,
        attempts: 3,
        verificationCodeHash: 'hash',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.verifyRegistration({ email: 'user@example.com', code: '000000' }),
    ).rejects.toMatchObject({
      response: { attemptsRemaining: 1 },
      status: 400,
    });
    // Parallel guesses queue on this lock instead of all reading attempts=3.
    expect(mockTxFor).toHaveBeenCalledWith('update');
    // The callback resolved, so the incremented counter was committed.
    await expect(
      (db.transaction as jest.Mock).mock.results[0].value,
    ).resolves.toEqual({ kind: 'invalid_code', attempts: 4 });
  });

  it('AUTH-VERIFY-006 commits the lockout on the fifth failed attempt', async () => {
    mockTxLimit.mockResolvedValueOnce([
      {
        email: 'user@example.com',
        expiresAt: new Date(Date.now() + 60_000),
        lockedUntil: null,
        attempts: 4,
        verificationCodeHash: 'hash',
      },
    ]);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.verifyRegistration({ email: 'user@example.com', code: '000000' }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      (db.transaction as jest.Mock).mock.results[0].value,
    ).resolves.toEqual({ kind: 'too_many_attempts' });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('AUTH-REG-004 does not reset a lockout set by a concurrent verification', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
    // ON CONFLICT ... DO UPDATE WHERE <not locked> matched nothing.
    mockUpsertReturning.mockResolvedValueOnce([]);

    await expect(
      service.register({ email: 'user@example.com', password: 'Password1' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ setWhere: expect.anything() }),
    );
    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-RESET-001 consumes a reset token only once under concurrency', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 1 }]);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    // A concurrent reset with the same link already cleared the token.
    mockTxUpdateReturning.mockResolvedValueOnce([]);

    await expect(
      service.resetPassword({
        token: 't'.repeat(64),
        newPassword: 'Password1',
      }),
    ).rejects.toMatchObject({ status: 400 });
    // Sessions are not revoked and no activity is written for the loser.
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('AUTH-GOOGLE-001 emits user.registered with the new Google account', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockTxReturning.mockResolvedValueOnce([
      {
        id: 4,
        email: 'g@example.com',
        username: null,
        displayName: 'g',
        role: 'user',
        createdAt: new Date('2026-09-27T10:00:00Z'),
      },
    ]);

    await service.loginWithGoogle({ email: 'g@example.com', googleId: 'gid' });

    const event = mockTxInsertValues.mock.calls.at(-1)[0];
    expect(event).toMatchObject({
      eventType: 'user.registered',
      payload: { userId: 4, method: 'google' },
    });
    expect(JSON.stringify(event)).not.toContain('g@example.com');
  });

  it('AUTH-GOOGLE-002 completes as a login when a concurrent duplicate Google sign-up races the insert', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // userByGoogleId: none yet
      .mockResolvedValueOnce([]) // userByEmail: none yet
      .mockResolvedValueOnce([
        // Re-read by googleId after the 23505: the winning concurrent
        // request already created this exact account.
        {
          id: 9,
          email: 'race@example.com',
          username: null,
          displayName: 'race',
          role: 'user',
          googleId: 'gid-race',
        },
      ]);
    (db.transaction as jest.Mock).mockRejectedValueOnce({
      code: '23505',
      constraint: 'users_google_id_key',
    });

    await expect(
      service.loginWithGoogle({
        email: 'race@example.com',
        googleId: 'gid-race',
      }),
    ).resolves.toEqual({
      message: 'Google login successful',
      user: {
        id: 9,
        email: 'race@example.com',
        username: null,
        displayName: 'race',
        role: 'user',
      },
    });
  });

  it('AUTH-GOOGLE-003 links by email when the race conflict was on email alone', async () => {
    mockLimit
      .mockResolvedValueOnce([]) // userByGoogleId: none yet
      .mockResolvedValueOnce([]) // userByEmail: none yet
      .mockResolvedValueOnce([]) // re-read by googleId: no such account
      .mockResolvedValueOnce([
        // An account with this email was created in between (e.g. a
        // concurrent email registration), but isn't linked to Google yet.
        {
          id: 10,
          email: 'race2@example.com',
          username: null,
          displayName: 'race2',
          role: 'user',
          googleId: null,
        },
      ]);
    (db.transaction as jest.Mock).mockRejectedValueOnce({
      code: '23505',
      constraint: 'users_email_key',
    });
    mockTxUpdateReturning.mockResolvedValueOnce([
      {
        id: 10,
        email: 'race2@example.com',
        username: null,
        displayName: 'race2',
        role: 'user',
        googleId: 'gid-race2',
      },
    ]);

    await expect(
      service.loginWithGoogle({
        email: 'race2@example.com',
        googleId: 'gid-race2',
      }),
    ).resolves.toEqual({
      message: 'Google account linked successfully',
      user: {
        id: 10,
        email: 'race2@example.com',
        username: null,
        displayName: 'race2',
        role: 'user',
      },
    });
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
    mockTxLimit.mockResolvedValueOnce([
      { suspendedUntil: null, suspensionReason: null },
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
    if (!('refreshToken' in result)) throw new Error('Expected a session');
    expect(result.refreshToken).toHaveLength(64);
    expect(mockTxInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(mockTxInsertValues.mock.calls[0][0].tokenHash).not.toBe(
      result.refreshToken,
    );
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: 1,
        email: 'user@example.com',
        role: 'user',
        mfaVerified: false,
        sessionIssuedAt: expect.any(Number),
      },
      { expiresIn: '5m' },
    );
  });

  it('rotates a refresh session and reloads the current database role', async () => {
    mockTxLimit
      .mockResolvedValueOnce([
        {
          id: 7,
          userId: 1,
          familyId: '22222222-2222-4222-8222-222222222222',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          usedAt: null,
          mfaVerifiedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: null,
          displayName: 'User',
          role: 'moderator',
          isSystemOwner: true,
        },
      ]);

    const result = await service.refreshSession('r'.repeat(64));

    expect(result.user.role).toBe('moderator');
    expect(result.user.isSystemOwner).toBe(true);
    expect(result.refreshToken).toHaveLength(64);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        sub: 1,
        email: 'user@example.com',
        role: 'moderator',
        mfaVerified: true,
        sessionIssuedAt: expect.any(Number),
      },
      { expiresIn: '5m' },
    );
  });

  it('rejects an expired or already consumed refresh session', async () => {
    mockTxLimit.mockResolvedValueOnce([]);

    await expect(service.refreshSession('r'.repeat(64))).rejects.toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
      status: 401,
    });
  });

  it('revokes a refresh-token family when a rotated token is reused', async () => {
    mockTxLimit.mockResolvedValueOnce([
      {
        id: 7,
        userId: 1,
        familyId: '22222222-2222-4222-8222-222222222222',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
        usedAt: new Date(),
        mfaVerifiedAt: null,
      },
    ]);

    await expect(service.refreshSession('r'.repeat(64))).rejects.toMatchObject({
      response: { code: 'REFRESH_TOKEN_REUSED' },
      status: 401,
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('AUTH-LOGIN-002 does not disclose whether an account exists', async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      service.validateUser('missing@example.com', 'Password1'),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_CREDENTIALS' },
      status: 401,
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
