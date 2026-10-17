// EN: Validates one-off or weekly program scheduling, including start date, weekday, and optional recurrence end.
// UK: Перевіряє одноразове або щотижневе планування програми, включно з датою початку, днем тижня та необов'язковим завершенням повторення.

import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class ScheduleProgramDto {
  @IsInt()
  @Min(1)
  programId: number;

  @IsDateString()
  scheduledFor: string;

  @IsOptional()
  @IsIn(['none', 'weekly'])
  repeat?: 'none' | 'weekly';

  @IsOptional()
  @IsDateString()
  repeatUntil?: string;
}

export class ListScheduleDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
