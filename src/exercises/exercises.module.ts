// EN: Wires exercise HTTP routes to the catalog service, storage, and transactional outbox dependencies.
// UK: З'єднує HTTP-маршрути вправ із сервісом каталогу, сховищем і залежностями транзакційного outbox.

import { Module } from '@nestjs/common';
import {
  ExercisesController,
  SharedExercisesController,
} from './exercises.controller';
import { ExercisesService } from './exercises.service';
import { RolesGuard } from '../auth/roles.guard';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ExercisesController, SharedExercisesController],
  providers: [ExercisesService, RolesGuard],
  exports: [ExercisesService],
})
export class ExercisesModule {}
