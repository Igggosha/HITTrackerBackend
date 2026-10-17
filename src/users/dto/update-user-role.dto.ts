// EN: Restricts administrative role updates to the supported user-role values.
// UK: Обмежує адміністративне оновлення ролі підтримуваними значеннями ролей користувача.

import { IsIn } from 'class-validator';
import { userRoles, type UserRole } from '../../db/schema';

export class UpdateUserRoleDto {
  @IsIn(userRoles)
  role: UserRole;
}
