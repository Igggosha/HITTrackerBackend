import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class StartWorkoutDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  programContentId?: number;
}

export class RecordSetDto {
  @IsNumber()
  exerciseId: number;

  @IsNumber()
  @Min(0)
  weight: number;

  @IsNumber()
  @Min(0)
  reps: number;

  @IsOptional()
  @IsBoolean()
  isFailure?: boolean;

  @IsOptional()
  @IsBoolean()
  isDropSet?: boolean;

  @IsOptional()
  @IsNumber()
  rpe?: number;
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
