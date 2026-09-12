import { Module } from '@nestjs/common';
import { SharedWorkoutProgramsController, WorkoutProgramsController } from './workout-programs.controller';
import { WorkoutProgramsService } from './workout-programs.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [WorkoutProgramsController, SharedWorkoutProgramsController],
  providers: [WorkoutProgramsService, RolesGuard],
  exports: [WorkoutProgramsService],
})
export class WorkoutProgramsModule {}
