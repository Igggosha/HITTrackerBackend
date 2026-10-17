// EN: Wires workout-program routes to scheduling, sharing, storage, notifications, and outbox infrastructure.
// UK: З'єднує маршрути програм тренувань з інфраструктурою планування, поширення, сховища, сповіщень та outbox.

import { Module } from '@nestjs/common';
import {
  SharedWorkoutProgramsController,
  WorkoutProgramsController,
} from './workout-programs.controller';
import { WorkoutProgramsService } from './workout-programs.service';
import { RolesGuard } from '../auth/roles.guard';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [WorkoutProgramsController, SharedWorkoutProgramsController],
  providers: [WorkoutProgramsService, RolesGuard],
  exports: [WorkoutProgramsService],
})
export class WorkoutProgramsModule {}
