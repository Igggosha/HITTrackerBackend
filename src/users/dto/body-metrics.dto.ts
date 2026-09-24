import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { BODY_METRIC_RANGES } from '../body-metrics';

export class CreateBodyMetricDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(BODY_METRIC_RANGES.weight.min)
  @Max(BODY_METRIC_RANGES.weight.max)
  weight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(BODY_METRIC_RANGES.bodyFatPercentage.min)
  @Max(BODY_METRIC_RANGES.bodyFatPercentage.max)
  bodyFatPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(BODY_METRIC_RANGES.muscleMass.min)
  @Max(BODY_METRIC_RANGES.muscleMass.max)
  muscleMass?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(BODY_METRIC_RANGES.waistCircumference.min)
  @Max(BODY_METRIC_RANGES.waistCircumference.max)
  waistCircumference?: number;

  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

export class ListBodyMetricsDto {
  @IsDefined()
  @IsDateString()
  from!: string;

  @IsDefined()
  @IsDateString()
  to!: string;
}
