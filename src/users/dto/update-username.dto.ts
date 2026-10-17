// EN: Defines the raw username update payload; canonical normalization and reservation rules remain in UsersService.
// UK: Описує вхідні дані оновлення username; канонічна нормалізація та правила резервування залишаються в UsersService.

import { IsString } from 'class-validator';

export class UpdateUsernameDto {
  @IsString()
  username!: string;
}
