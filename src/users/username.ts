export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 24;

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'moderator',
  'moder',
  'mod',
  'adm',
  'support',
  'staff',
  'help',
  'official',
  'system',
  'root',
  'owner',
  'hittracker',
  'hit_tracker',
]);

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const username = normalizeUsername(value);
  return (
    username.length >= MIN_USERNAME_LENGTH &&
    username.length <= MAX_USERNAME_LENGTH &&
    /^[a-z0-9_]+$/.test(username)
  );
}

export function isReservedUsername(value: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(value));
}
