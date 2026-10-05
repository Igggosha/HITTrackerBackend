import { Transform } from 'class-transformer';
import { IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

const trimReason = (value: unknown) =>
  typeof value === 'string' ? value.trim() : value;

export class SuspendUserDto {
  @IsISO8601()
  suspendedUntil!: string;

  @IsString()
  @Transform(({ value }) => trimReason(value))
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
