// EN: Wires workout lifecycle routes to their service and transactional outbox dependency.
// UK: З'єднує маршрути життєвого циклу тренувань із сервісом і залежністю транзакційного outbox.

import { Module } from '@nestjs/common';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';

@Module({
  controllers: [WorkoutsController],
  providers: [WorkoutsService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
