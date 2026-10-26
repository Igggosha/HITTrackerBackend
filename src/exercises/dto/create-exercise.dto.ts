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
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class ExerciseTranslationDto {
  @Matches(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/) locale: string;
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional()
  @IsUrl({ require_tld: true })
  @MaxLength(2048)
  videoUrl?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  aliases?: string[];
}

export class EquipmentStructuredDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  required: string[];
  @IsArray()
  @ArrayMaxSize(20)
  @IsArray({ each: true })
  alternatives: string[][];
}

export class CreateExerciseDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) catalogKey?: string;
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  recommendedSets?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  recommendedReps?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExerciseTranslationDto)
  translations?: ExerciseTranslationDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EquipmentStructuredDto)
  equipmentStructured?: EquipmentStructuredDto;

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
