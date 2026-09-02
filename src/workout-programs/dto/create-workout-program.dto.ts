import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateWorkoutProgramDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
