import { buildObjectKey, isManagedObjectKey } from './object-key';

describe('object keys', () => {
  it('groups objects by scope and owner', () => {
    const key = buildObjectKey({
      prefix: 'uploads',
      scope: 'avatars',
      ownerId: 42,
      extension: 'webp',
    });

    expect(key).toMatch(/^uploads\/avatars\/42\/[0-9a-f-]{36}\.webp$/);
  });

  it('gives a replacement its own key so caches cannot serve the old image', () => {
    const parts = {
      prefix: 'uploads',
      scope: 'avatars' as const,
      ownerId: 1,
      extension: 'webp',
    };

    expect(buildObjectKey(parts)).not.toBe(buildObjectKey(parts));
  });

  it('refuses parts that could reshape the key', () => {
    expect(() =>
      buildObjectKey({
        prefix: '../uploads',
        scope: 'avatars',
        ownerId: 1,
        extension: 'webp',
      }),
    ).toThrow('prefix');
    expect(() =>
      buildObjectKey({
        prefix: 'uploads',
        scope: 'secrets' as never,
        ownerId: 1,
        extension: 'webp',
      }),
    ).toThrow('scope');
    expect(() =>
      buildObjectKey({
        prefix: 'uploads',
        scope: 'avatars',
        ownerId: 0,
        extension: 'webp',
      }),
    ).toThrow('owner');
    expect(() =>
      buildObjectKey({
        prefix: 'uploads',
        scope: 'avatars',
        ownerId: 1,
        extension: 'sh/..',
      }),
    ).toThrow('extension');
  });

  it('only trusts keys that sit under a managed prefix', () => {
    const prefixes = ['uploads', 'tmp'];

    expect(isManagedObjectKey('uploads/avatars/1/a.webp', prefixes)).toBe(true);
    expect(isManagedObjectKey('tmp/avatars/1/a.webp', prefixes)).toBe(true);
    expect(isManagedObjectKey('other/avatars/1/a.webp', prefixes)).toBe(false);
    expect(isManagedObjectKey('uploads', prefixes)).toBe(false);
    expect(isManagedObjectKey('', prefixes)).toBe(false);
  });

  it('rejects keys that try to climb out of their prefix', () => {
    const prefixes = ['uploads'];

    expect(isManagedObjectKey('uploads/../../etc/passwd', prefixes)).toBe(
      false,
    );
    expect(isManagedObjectKey('uploads//avatars/1/a.webp', prefixes)).toBe(
      false,
    );
    expect(isManagedObjectKey('/uploads/avatars/1/a.webp', prefixes)).toBe(
      false,
    );
    expect(
      isManagedObjectKey('uploads/a.webp'.padEnd(600, 'x'), prefixes),
    ).toBe(false);
  });
});
