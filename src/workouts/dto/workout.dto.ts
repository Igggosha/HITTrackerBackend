import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WorkoutPlanItemDto {
  @IsInt()
  @Min(1)
  exerciseId: number;

  @IsInt()
  @Min(0)
  sets: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reps?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;
}

export class StartWorkoutDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  programContentId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  scheduleId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  programId?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkoutPlanItemDto)
  plan?: WorkoutPlanItemDto[];
}

export class RecordSetDto {
  @IsInt()
  @Min(1)
  exerciseId: number;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsInt()
  @Min(1)
  reps: number;

  @IsOptional()
  @IsBoolean()
  isFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  isDropSet?: boolean;

  @IsInt()
  @Min(1)
  @Max(10)
  rpe: number;
}

export class UpdateSetDto {
  @IsNumber()
  @Min(0)
  weight: number;

  @IsInt()
  @Min(1)
  reps: number;

  @IsInt()
  @Min(1)
  @Max(10)
  rpe: number;

  @IsOptional()
  @IsBoolean()
  isFailure?: boolean;
}

export class FinishWorkoutDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @IsOptional()
  @IsDateString()
  finishedAt?: string;
}

export class ListWorkoutHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class WorkoutHistoryDatesDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
