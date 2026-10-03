import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { db } from '../db/db';
import {
  outboxEvents,
  userActivityEvents,
  userBodyMetrics,
  users,
} from '../db/schema';
import { OutboxService } from '../outbox/outbox.service';
import {
  calledWith,
  fakeOf,
  insertedValues,
} from '../outbox/testing/fake-database';
import type { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';

jest.mock('../db/db', () =>
  jest
    .requireActual<typeof import('../outbox/testing/fake-database')>(
      '../outbox/testing/fake-database',
    )
    .fakeDbModule(),
);

const fake = fakeOf(db);
const remove = jest.fn();
const storage = {
  remove,
  getUrl: jest.fn().mockResolvedValue(null),
} as unknown as StorageService;

const inserted = (table: unknown) => insertedValues(fake, table);

describe('UsersService transactions', () => {
  const service = new UsersService(
    { get: jest.fn(() => 25) } as unknown as ConfigService,
    storage,
    new OutboxService(),
  );

  beforeEach(() => {
    fake.reset();
    remove.mockReset();
  });

  it('decides a role change on locked rows, in id order', async () => {
    // Between the admin opening the page and saving, the target was promoted
    // to super_admin. The locked read sees it and the change is refused.
    fake.returns('select', users, [
      { id: 2, role: 'admin' },
      { id: 5, role: 'super_admin' },
    ]);

    await expect(service.updateUserRole(2, 5, 'user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const [lock] = fake.find('select', users);
    expect(lock.scope).toBe('tx');
    expect(calledWith(lock, 'for')[0].args).toEqual(['update']);
    expect(calledWith(lock, 'orderBy')).toHaveLength(1);
    expect(fake.find('update')).toHaveLength(0);
  });

  it('protects the system owner from role changes and deletion', async () => {
    fake.returns('select', users, [
      { id: 1, role: 'admin', isSystemOwner: false },
      { id: 5, role: 'super_admin', isSystemOwner: true },
    ]);

    await expect(service.updateUserRole(1, 5, 'user')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.deleteUser(1, 5)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(fake.find('update')).toHaveLength(0);
    expect(fake.find('delete')).toHaveLength(0);
  });

  it('lets only the system owner manage super admins', async () => {
    fake.returns('select', users, [
      { id: 1, role: 'super_admin', isSystemOwner: false },
      { id: 5, role: 'user', isSystemOwner: false },
    ]);
    await expect(
      service.updateUserRole(1, 5, 'super_admin'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the system owner appoint a super admin', async () => {
    fake.returns('select', users, [
      { id: 1, role: 'super_admin', isSystemOwner: true },
      { id: 5, role: 'admin', isSystemOwner: false },
    ]);
    fake.returns('update', users, [{ id: 5, role: 'super_admin' }]);

    await service.updateUserRole(1, 5, 'super_admin');

    expect(fake.committed('update', users)).toHaveLength(1);
  });

  it('writes the role change and its activity row atomically', async () => {
    fake.returns('select', users, [
      { id: 1, role: 'super_admin' },
      { id: 5, role: 'user' },
    ]);
    fake.returns('update', users, [{ id: 5, role: 'moderator' }]);

    await service.updateUserRole(1, 5, 'moderator');

    const [update] = fake.committed('update', users);
    const [activity] = fake.committed('insert', userActivityEvents);
    expect(activity.transactionId).toBe(update.transactionId);
    expect(inserted(userActivityEvents)[0]).toMatchObject({
      type: 'role.changed',
      metadata: { from: 'user', to: 'moderator' },
    });
  });

  it('emits user.deleted inside the delete and removes the avatar after commit', async () => {
    fake.returns('select', users, [
      { id: 1, role: 'super_admin' },
      { id: 5, role: 'user' },
    ]);
    fake.returns('delete', users, [
      {
        id: 5,
        email: 'gone@example.com',
        username: null,
        displayName: 'Gone',
        role: 'user',
        avatarKey: 'uploads/avatars/5/a.webp',
      },
    ]);
    remove.mockImplementation(() => {
      // Storage runs only once the transaction has finished.
      expect(fake.committed('insert', outboxEvents)).toHaveLength(1);
      return Promise.resolve();
    });

    const result = await service.deleteUser(1, 5);

    expect(result.user).not.toHaveProperty('avatarKey');
    const [event] = inserted(outboxEvents);
    expect(event).toMatchObject({
      eventType: 'user.deleted',
      aggregateId: '5',
      payload: { userId: 5, deletedByUserId: 1 },
    });
    expect(JSON.stringify(event)).not.toContain('gone@example.com');
    expect(remove).toHaveBeenCalledWith('uploads/avatars/5/a.webp');
  });

  it('records a body metric and its event in one transaction', async () => {
    const recordedAt = new Date('2026-09-27T08:00:00Z');
    fake.returns('insert', userBodyMetrics, [
      {
        id: 3,
        weight: 80,
        bodyFatPercentage: null,
        muscleMass: null,
        waistCircumference: null,
        recordedAt,
      },
    ]);

    await service.createBodyMetric(1, {
      weight: 80,
      recordedAt: recordedAt.toISOString(),
    });

    expect(inserted(outboxEvents)[0]).toMatchObject({
      eventType: 'body_metric.recorded',
      aggregateId: '1',
      payload: {
        metricId: 3,
        userId: 1,
        weight: 80,
        recordedAt: '2026-09-27T08:00:00.000Z',
        source: 'body_metrics',
      },
    });
  });

  it('rolls back the profile, weight entry and event when the activity row fails', async () => {
    fake.returns('select', users, [
      {
        email: 'user@example.com',
        displayName: 'Before',
        age: null,
        gender: null,
        height: null,
        goal: null,
      },
    ]);
    fake.returns('update', users, [{ id: 1 }]);
    fake.returns('insert', userBodyMetrics, [
      {
        id: 3,
        weight: 81,
        bodyFatPercentage: null,
        muscleMass: null,
        waistCircumference: null,
        recordedAt: new Date(),
      },
    ]);
    fake.fails('insert', userActivityEvents, new Error('activity down'));

    await expect(
      service.updateProfile(1, { displayName: 'After', weight: 81 }),
    ).rejects.toThrow('activity down');

    expect(fake.find('insert', outboxEvents)).toHaveLength(1);
    expect(fake.committed('insert', outboxEvents)).toHaveLength(0);
    expect(fake.committed('update', users)).toHaveLength(0);
    expect(fake.committed('insert', userBodyMetrics)).toHaveLength(0);
    // The previous values were read under a row lock.
    expect(calledWith(fake.find('select', users)[0], 'for')[0].args).toEqual([
      'update',
    ]);
  });
});
