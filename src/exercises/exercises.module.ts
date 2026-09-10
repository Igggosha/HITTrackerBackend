import { Module } from '@nestjs/common';
import { ExercisesController, SharedExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [ExercisesController, SharedExercisesController],
  providers: [ExercisesService, RolesGuard],
  exports: [ExercisesService],
})
export class ExercisesModule {}
