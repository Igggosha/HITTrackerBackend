// EN: Wires the protected observability endpoint to its cross-service aggregation service.
// UK: З'єднує захищений маршрут спостережуваності із сервісом агрегації даних різних компонентів.

import { Module } from '@nestjs/common';
import { AdminObservabilityController } from './admin-observability.controller';
import { AdminObservabilityService } from './admin-observability.service';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [AdminObservabilityController],
  providers: [AdminObservabilityService, RolesGuard],
})
export class AdminObservabilityModule {}
