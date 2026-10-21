// EN: Validates exercise creation data, including separate optional lists for primary and secondary trained muscles.
// UK: Перевіряє дані створення вправи, включно з окремими необов'язковими списками основних і допоміжних м'язів.

import { Type } from 'class-transformer';
import {
  ArrayUnique,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateExerciseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUrl({ require_tld: true })
  @MaxLength(2048)
  videoUrl?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @IsOptional()
  @IsIn(['reps', 'duration'])
  measurementType?: 'reps' | 'duration';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(86400)
  recommendedDurationSeconds?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  equipment?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  primaryMuscleIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  secondaryMuscleIds?: number[];
}
