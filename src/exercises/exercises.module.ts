import { Module } from '@nestjs/common';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [ExercisesController],
  providers: [ExercisesService, RolesGuard],
  exports: [ExercisesService],
})
export class ExercisesModule {}
