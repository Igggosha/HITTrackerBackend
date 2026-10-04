import { hasMinimumRole, requiresMfa } from './roles';

describe('hasMinimumRole', () => {
  it('allows inherited permissions but never a higher role', () => {
    expect(hasMinimumRole('super_admin', 'admin')).toBe(true);
    expect(hasMinimumRole('moderator', 'helper')).toBe(true);
    expect(hasMinimumRole('helper', 'moderator')).toBe(false);
  });

  it('requires MFA for every privileged role', () => {
    expect(requiresMfa('user')).toBe(false);
    for (const role of [
      'helper',
      'moderator',
      'admin',
      'super_admin',
    ] as const) {
      expect(requiresMfa(role)).toBe(true);
    }
  });
});
