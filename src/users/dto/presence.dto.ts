// EN: Validates presence heartbeats and treats installation ID plus platform as an all-or-nothing pair for push-device registration.
// UK: Перевіряє presence-сигнали та вимагає, щоб ідентифікатор установки й платформа передавалися разом для реєстрації push-пристрою.

import { IsIn, IsUUID, ValidateIf } from 'class-validator';

export class PresenceDto {
  @ValidateIf(
    (value: PresenceDto) =>
      value.installationId !== undefined || value.platform !== undefined,
  )
  @IsUUID('4')
  installationId?: string;

  @ValidateIf(
    (value: PresenceDto) =>
      value.installationId !== undefined || value.platform !== undefined,
  )
  @IsIn(['android', 'ios', 'web'])
  platform?: 'android' | 'ios' | 'web';
}
