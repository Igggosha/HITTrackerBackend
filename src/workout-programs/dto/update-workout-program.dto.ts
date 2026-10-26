// EN: Validates partial program metadata and optional complete content replacement for owner-authorized edits.
// UK: Перевіряє часткові зміни метаданих програми та необов'язкову повну заміну вмісту для дозволених власнику редагувань.

import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ProgramExerciseDto } from './create-workout-program.dto';
import { ProgramTranslationDto } from './create-workout-program.dto';

export class UpdateWorkoutProgramDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000000)
  displayedLikesCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProgramTranslationDto)
  translations?: ProgramTranslationDto[];
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ require_tld: true })
  @Matches(/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i)
  @MaxLength(2048)
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProgramExerciseDto)
  exercises?: ProgramExerciseDto[];
}
