import { hasMinimumRole } from './roles';

describe('hasMinimumRole', () => {
  it('allows inherited permissions but never a higher role', () => {
    expect(hasMinimumRole('super_admin', 'admin')).toBe(true);
    expect(hasMinimumRole('moderator', 'helper')).toBe(true);
    expect(hasMinimumRole('helper', 'moderator')).toBe(false);
  });
});
