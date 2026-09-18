import { db } from '../db/db';
import type { StorageService, StoredImage } from '../storage/storage.service';
import { UsersService } from './users.service';

// Storage is switched off in these tests, so every avatar URL resolves to null.
// The doubles are standalone consts so assertions never reference an unbound
// method off the stub object.
const getAvatarUrl = jest.fn<Promise<string | null>, [unknown]>();
const removeObject = jest.fn<Promise<void>, [unknown]>();
const uploadImage = jest.fn<Promise<StoredImage>, [unknown]>();

const storage = {
  getUrl: getAvatarUrl,
  remove: removeObject,
  uploadImage,
  limits: { avatarMaxDimension: 512 },
} as unknown as StorageService;

const mockDbLimit = jest.fn();
const mockTxLimit = jest.fn();
const mockTxReturning = jest.fn();
const mockReservationValues = jest.fn();
const mockReservationUpsert = jest.fn();
const mockDbSet = jest.fn();
const mockDbReturning = jest.fn();
const mockDbDeleteReturning = jest.fn();

const tx = {
  execute: jest.fn(),
  select: jest.fn(() => ({
    from: () => ({
      where: () => ({
        limit: mockTxLimit,
        for: () => ({ limit: mockTxLimit }),
      }),
    }),
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
    delete: jest.fn(() => ({
      where: () => ({ returning: mockDbDeleteReturning }),
    })),
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
  const service = new UsersService({ get: jest.fn(() => 25) } as any, storage);

  beforeEach(() => {
    jest.clearAllMocks();
    getAvatarUrl.mockResolvedValue(null);
    removeObject.mockResolvedValue(undefined);
    mockDbLimit.mockReset();
    mockTxLimit.mockReset();
    mockTxReturning.mockReset();
    mockReservationValues.mockReset();
    mockReservationUpsert.mockReset();
    mockDbSet.mockReset();
    mockDbReturning.mockReset();
    mockDbDeleteReturning.mockReset();
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

  it('PROFILE-USERNAME-012 rejects an exact reserved username before database access', async () => {
    await expect(
      service.getUsernameAvailability(1, 'admin'),
    ).rejects.toMatchObject({
      response: { code: 'USERNAME_RESERVED' },
      status: 400,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('removes a deleted user avatar without exposing its object key', async () => {
    mockDbLimit
      .mockResolvedValueOnce([{ role: 'super_admin' }])
      .mockResolvedValueOnce([{ id: 2, role: 'user' }]);
    mockDbDeleteReturning.mockResolvedValueOnce([
      {
        id: 2,
        email: 'deleted@example.com',
        username: 'deleted',
        displayName: 'Deleted User',
        role: 'user',
        avatarKey: 'uploads/avatars/2/avatar.webp',
      },
    ]);

    await expect(service.deleteUser(1, 2)).resolves.toEqual({
      user: {
        id: 2,
        email: 'deleted@example.com',
        username: 'deleted',
        displayName: 'Deleted User',
        role: 'user',
      },
    });
    expect(removeObject).toHaveBeenCalledWith('uploads/avatars/2/avatar.webp');
  });
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

  it('AVATAR-001 stores the new object, then deletes the one it replaced', async () => {
    uploadImage.mockResolvedValue({
      key: 'uploads/avatars/1/new.webp',
      width: 512,
      height: 512,
    });
    mockTxLimit.mockResolvedValueOnce([
      { avatarKey: 'uploads/avatars/1/old.webp' },
    ]);
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: 'john',
          displayName: 'John Doe',
          role: 'user',
          avatarKey: 'uploads/avatars/1/new.webp',
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.updateAvatar(
      1,
      { buffer: Buffer.from('x') },
      true,
    );

    expect(removeObject).toHaveBeenCalledWith('uploads/avatars/1/old.webp');
    // The raw object key must never appear in a response.
    expect(result).not.toHaveProperty('avatarKey');
    expect(result.avatarUrl).toBeNull();
  });

  it('AVATAR-002 removes the uploaded object when the row cannot be updated', async () => {
    uploadImage.mockResolvedValue({
      key: 'uploads/avatars/9/new.webp',
      width: 512,
      height: 512,
    });
    // The account disappeared between the upload and the update.
    mockTxLimit.mockResolvedValueOnce([]);

    await expect(
      service.updateAvatar(9, { buffer: Buffer.from('x') }),
    ).rejects.toMatchObject({ status: 404 });
    expect(removeObject).toHaveBeenCalledWith('uploads/avatars/9/new.webp');
  });

  it('AVATAR-003 clears the key and deletes the object on removal', async () => {
    mockTxLimit.mockResolvedValueOnce([
      { avatarKey: 'uploads/avatars/1/old.webp' },
    ]);
    mockDbLimit
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'user@example.com',
          username: 'john',
          displayName: 'John Doe',
          role: 'user',
          avatarKey: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.removeAvatar(1, true);

    expect(removeObject).toHaveBeenCalledWith('uploads/avatars/1/old.webp');
    expect(result.avatarUrl).toBeNull();
  });
});
