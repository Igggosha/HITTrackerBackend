import {
  isValidUsername,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  normalizeUsername,
} from './username';

describe('PROFILE-USERNAME-006 username validation', () => {
  it('normalizes case and accepts the allowed separators', () => {
    expect(normalizeUsername(' User._Name ')).toBe('user._name');
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('_ab')).toBe(true);
    expect(isValidUsername('ab_')).toBe(true);
    expect(isValidUsername('a__b')).toBe(true);
    expect(isValidUsername('a._b')).toBe(true);
    expect(isValidUsername('a_.b')).toBe(true);
  });

  it('rejects invalid length, characters, and dot placement', () => {
    expect(isValidUsername('a'.repeat(MIN_USERNAME_LENGTH - 1))).toBe(false);
    expect(isValidUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toBe(false);
    expect(isValidUsername('user-name')).toBe(false);
    expect(isValidUsername('користувач')).toBe(false);
    expect(isValidUsername('.user')).toBe(false);
    expect(isValidUsername('user.')).toBe(false);
    expect(isValidUsername('user..name')).toBe(false);
  });
});
