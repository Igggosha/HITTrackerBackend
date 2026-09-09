import { db } from '../db/db';
import { UsersService } from './users.service';

const mockDbLimit = jest.fn();
const mockTxLimit = jest.fn();
const mockTxReturning = jest.fn();
const mockReservationValues = jest.fn();
const mockReservationUpsert = jest.fn();
const mockDbSet = jest.fn();
const mockDbReturning = jest.fn();

const tx = {
  execute: jest.fn(),
  select: jest.fn(() => ({
    from: () => ({ where: () => ({ limit: mockTxLimit }) }),
  })),
  insert: jest.fn(() => ({ values: mockReservationValues })),
  delete: jest.fn(() => ({ where: jest.fn() })),
  update: jest.fn(() => ({
    set: () => ({
      where: () => ({ returning: mockTxReturning }),
    }),
  })),
};

jest.mock('../db/db', () => ({
  db: {
    transaction: jest.fn((callback) => callback(tx)),
    update: jest.fn(() => ({ set: mockDbSet })),
    insert: jest.fn(),
    select: jest.fn(() => ({
      from: () => ({
        where: () => ({
          limit: mockDbLimit,
          orderBy: () => ({ limit: mockDbLimit }),
        }),
      }),
    })),
  },
}));

describe('UsersService profile identity', () => {
  const service = new UsersService({ get: jest.fn(() => 25) } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbLimit.mockReset();
    mockTxLimit.mockReset();
    mockTxReturning.mockReset();
    mockReservationValues.mockReset();
    mockReservationUpsert.mockReset();
    mockDbSet.mockReset();
    mockDbReturning.mockReset();
    mockDbSet.mockReturnValue({
      where: () => ({ returning: mockDbReturning }),
    });
    (db.transaction as jest.Mock).mockImplementation((callback) =>
      callback(tx),
    );
    mockReservationValues.mockReturnValue({
      onConflictDoUpdate: mockReservationUpsert,
    });
  });

  afterEach(() => jest.useRealTimers());

  it('PROFILE-USERNAME-002 hides active reservations while allowing the owner', async () => {
    mockDbLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 2 }]);
    await expect(
      service.getUsernameAvailability(1, 'reserved_name'),
    ).resolves.toEqual({ username: 'reserved_name', available: false });

    mockDbLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: 1 }]);
    await expect(
      service.getUsernameAvailability(1, 'reserved_name'),
    ).resolves.toEqual({ username: 'reserved_name', available: true });
  });

  it('PROFILE-USERNAME-005 returns a clear conflict when final save loses the race', async () => {
    (db.transaction as jest.Mock).mockRejectedValue({
      code: '23505',
      constraint: 'users_username_key',
    });

    await expect(service.updateUsername(1, 'taken_name')).rejects.toMatchObject(
      {
        response: { code: 'USERNAME_ALREADY_EXISTS' },
        status: 409,
      },
    );

    expect(db.transaction).toHaveBeenCalled();
  });

  it('PROFILE-USERNAME-007 does not reveal or release another user active reservation', async () => {
    mockTxLimit
      .mockResolvedValueOnce([{ username: 'current_name' }])
      .mockResolvedValueOnce([{ userId: 2 }]);

    await expect(
      service.updateUsername(1, 'reserved_name'),
    ).rejects.toMatchObject({
      response: { code: 'USERNAME_ALREADY_EXISTS' },
      status: 409,
    });

    expect(mockReservationValues).not.toHaveBeenCalled();
  });

  it('PROFILE-USERNAME-008 reserves the previous username for the configured period', async () => {
    const now = new Date('2026-09-09T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    mockTxLimit
      .mockResolvedValueOnce([{ username: 'current_name' }])
      .mockResolvedValueOnce([]);
    mockTxReturning.mockResolvedValue([{ id: 1 }]);
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: 'new_name',
          displayName: 'User',
          role: 'user',
        },
      ])
      .mockResolvedValueOnce([]);

    await service.updateUsername(1, 'New_Name');

    expect(mockReservationValues).toHaveBeenCalledWith({
      username: 'current_name',
      userId: 1,
      reservedUntil: new Date('2026-09-09T12:25:00.000Z'),
    });
    expect(mockTxReturning).toHaveBeenCalled();
  });

  it('PROFILE-USERNAME-009 lets the owner reclaim a reserved username', async () => {
    mockTxLimit
      .mockResolvedValueOnce([{ username: 'new_name' }])
      .mockResolvedValueOnce([{ userId: 1 }]);
    mockTxReturning.mockResolvedValue([{ id: 1 }]);
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: 'old_name',
          displayName: 'User',
          role: 'user',
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(service.updateUsername(1, 'old_name')).resolves.toMatchObject({
      username: 'old_name',
    });
    expect(tx.delete).toHaveBeenCalled();
  });

  it('PROFILE-USERNAME-012 preserves the legacy profile-name contract', async () => {
    mockDbReturning.mockResolvedValue([{ id: 1 }]);
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: null,
          displayName: 'John Doe',
          role: 'user',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.updateProfile(1, { username: ' John Doe ' });

    expect(mockDbSet).toHaveBeenCalledWith({ displayName: 'John Doe' });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(result.username).toBe('John Doe');
  });

  it('PROFILE-USERNAME-013 exposes the nullable handle to v2 clients', async () => {
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: null,
          displayName: 'John Doe',
          role: 'user',
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(service.getProfile(1, true)).resolves.toMatchObject({
      displayName: 'John Doe',
      username: null,
    });
  });

  it('rejects a whitespace-only display name', async () => {
    await expect(
      service.updateProfile(1, { displayName: '   ' }),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_DISPLAY_NAME' },
      status: 400,
    });
  });
});
