import type { UserRole } from '../db/schema';

export const userRoleRank: Record<UserRole, number> = {
  user: 0,
  helper: 1,
  moderator: 2,
  admin: 3,
  super_admin: 4,
};

export const hasMinimumRole = (role: UserRole, minimumRole: UserRole) =>
  userRoleRank[role] >= userRoleRank[minimumRole];
