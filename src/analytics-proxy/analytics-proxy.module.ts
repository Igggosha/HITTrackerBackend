// EN: Registers the analytics proxy controller and its isolated upstream HTTP client service.
// UK: Реєструє контролер проксі аналітики та його ізольований HTTP-клієнт внутрішнього сервісу.

import { Module } from '@nestjs/common';
import { AnalyticsProxyController } from './analytics-proxy.controller';
import { AnalyticsProxyService } from './analytics-proxy.service';

@Module({
  controllers: [AnalyticsProxyController],
  providers: [AnalyticsProxyService],
})
export class AnalyticsProxyModule {}
