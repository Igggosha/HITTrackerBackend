import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { ProgramExerciseDto } from './create-workout-program.dto';

export class UpdateWorkoutProgramDto {
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
