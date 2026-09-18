import { randomUUID } from 'node:crypto';

/**
 * Object keys are stored in the database and handed back to the S3 client, so
 * they must be unguessable, stable, and impossible to point outside the
 * prefixes granted by the bucket policy.
 */

/** One folder per kind of media. Add a scope here before using it. */
export const STORAGE_SCOPES = ['avatars', 'exercises'] as const;
export type StorageScope = (typeof STORAGE_SCOPES)[number];

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const EXTENSION_PATTERN = /^[a-z0-9]{2,5}$/;
const MAX_KEY_LENGTH = 512;

export interface ObjectKeyParts {
  prefix: string;
  scope: StorageScope;
  /** Owning row id, so objects of one user stay grouped and easy to purge. */
  ownerId: number;
  extension: string;
}

/**
 * Builds `<prefix>/<scope>/<ownerId>/<random>.<ext>`.
 *
 * The random component means a replaced avatar gets a brand new key, which
 * sidesteps stale client and CDN image caches.
 */
export function buildObjectKey({
  prefix,
  scope,
  ownerId,
  extension,
}: ObjectKeyParts): string {
  if (!SEGMENT_PATTERN.test(prefix)) {
    throw new Error(`Invalid storage prefix: ${prefix}`);
  }
  if (!STORAGE_SCOPES.includes(scope)) {
    throw new Error(`Unknown storage scope: ${scope}`);
  }
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error(`Invalid storage owner id: ${ownerId}`);
  }
  if (!EXTENSION_PATTERN.test(extension)) {
    throw new Error(`Invalid storage extension: ${extension}`);
  }

  return `${prefix}/${scope}/${ownerId}/${randomUUID()}.${extension}`;
}

/**
 * Guards every key that arrives from the database before it reaches the S3
 * client: a row edited by hand must not be able to read or delete an object
 * outside the prefixes this service owns.
 */
export function isManagedObjectKey(
  key: string,
  allowedPrefixes: readonly string[],
): boolean {
  if (!key || key.length > MAX_KEY_LENGTH) return false;
  if (key.includes('..') || key.includes('//')) return false;
  if (key.startsWith('/')) return false;
  if (hasUnsafeCharacter(key)) return false;

  return allowedPrefixes.some((prefix) => key.startsWith(`${prefix}/`));
}

/** Control characters and backslashes never appear in a key we generated. */
function hasUnsafeCharacter(key: string): boolean {
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}
