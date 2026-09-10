import {
  isReservedUsername,
  isValidUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  normalizeUsername,
} from './username';

describe('PROFILE-USERNAME-006 username validation', () => {
  it('normalizes case and accepts lowercase letters, numbers, and underscores', () => {
    expect(normalizeUsername(' User_Name ')).toBe('user_name');
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('_ab')).toBe(true);
    expect(isValidUsername('ab_')).toBe(true);
    expect(isValidUsername('a__b')).toBe(true);
    expect(isValidUsername('user9')).toBe(true);
  });

  it('rejects invalid length and characters', () => {
    expect(isValidUsername('a'.repeat(MIN_USERNAME_LENGTH - 1))).toBe(false);
    expect(isValidUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toBe(false);
    expect(isValidUsername('user-name')).toBe(false);
    expect(isValidUsername('користувач')).toBe(false);
    expect(isValidUsername('user.name')).toBe(false);
  });

  it('reserves staff and product identity usernames', () => {
    for (const username of ['admin', 'moderator', 'support', 'official', 'adm', 'moder']) {
      expect(isReservedUsername(username)).toBe(true);
    }
    expect(isReservedUsername('regular_user')).toBe(false);
    expect(isReservedUsername('admiral')).toBe(false);
    expect(isReservedUsername('model')).toBe(false);
    expect(isReservedUsername('adminovich')).toBe(false);
    expect(isReservedUsername('bohdan_admin123')).toBe(false);
    expect(isReservedUsername('firma_official')).toBe(false);
  });
});
