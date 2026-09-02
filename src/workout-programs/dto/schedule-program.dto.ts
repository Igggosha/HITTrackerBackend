import { IsDateString, IsInt, Min } from 'class-validator';

export class ScheduleProgramDto {
  @IsInt()
  @Min(1)
  programId: number;

  @IsDateString()
  scheduledFor: string;
}
