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
