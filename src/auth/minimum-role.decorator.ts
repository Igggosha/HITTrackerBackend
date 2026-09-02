import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../db/schema';

export const MINIMUM_ROLE_KEY = 'minimumRole';
export const MinimumRole = (role: UserRole) => SetMetadata(MINIMUM_ROLE_KEY, role);
