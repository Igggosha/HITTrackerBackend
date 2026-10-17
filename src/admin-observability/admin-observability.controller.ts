// EN: Exposes the administrator-only operational overview assembled from health, Prometheus, and Loki data.
// UK: Надає лише адміністраторам операційний огляд, сформований із даних стану сервісів, Prometheus і Loki.

import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { MinimumRole } from '../auth/minimum-role.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminObservabilityService } from './admin-observability.service';

@Controller('admin/observability')
@UseGuards(JwtGuard, RolesGuard)
@MinimumRole('admin')
export class AdminObservabilityController {
  constructor(private readonly service: AdminObservabilityService) {}

  @Get()
  summary() {
    return this.service.summary();
  }
}
