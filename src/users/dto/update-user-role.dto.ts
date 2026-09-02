import { IsIn } from 'class-validator';
import { userRoles, type UserRole } from '../../db/schema';

export class UpdateUserRoleDto {
  @IsIn(userRoles)
  role: UserRole;
}
