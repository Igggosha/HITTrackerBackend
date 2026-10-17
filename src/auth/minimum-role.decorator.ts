// EN: Attaches the minimum required user role as route metadata consumed by RolesGuard.
// UK: Додає до маршруту метадані мінімально потрібної ролі користувача, які читає RolesGuard.

import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../db/schema';

export const MINIMUM_ROLE_KEY = 'minimumRole';
export const MinimumRole = (role: UserRole) =>
  SetMetadata(MINIMUM_ROLE_KEY, role);
