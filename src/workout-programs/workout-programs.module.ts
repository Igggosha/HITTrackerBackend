import { Module } from '@nestjs/common';
import { WorkoutProgramsController } from './workout-programs.controller';
import { WorkoutProgramsService } from './workout-programs.service';

@Module({
  controllers: [WorkoutProgramsController],
  providers: [WorkoutProgramsService],
})
export class WorkoutProgramsModule {}
