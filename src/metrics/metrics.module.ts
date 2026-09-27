import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

// Request recording is wired up in `configureApp`
// (`src/config/configure-app.ts`) as plain Express middleware, not here as
// an `APP_INTERCEPTOR`: interceptors only run for requests that pass every
// guard, so they miss 401/403/429/404 and pre-routing body-parser errors.
// `MetricsService` is exported so `configureApp` can fetch the same
// singleton instance the `/metrics` controller reads from.
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
