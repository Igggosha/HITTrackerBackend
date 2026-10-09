import { Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class WeeklyVolumeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(104)
  weeks: number = 12;
}

/** `from`/`to` are ISO 8601 dates or timestamps (UTC), both inclusive. */
export class DateRangeQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

/** Required inclusive ISO timestamp bounds for period analytics. */
export class RequiredDateRangeQueryDto {
  @IsDefined()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  from: string;

  @IsDefined()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/)
  to: string;
}

export class IntensityDayQueryDto {
  @IsDefined()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}

export class MuscleGroupsQueryDto extends RequiredDateRangeQueryDto {
  @IsDefined()
  @IsIn(['workingSets', 'volume'])
  metric: 'workingSets' | 'volume';
}
