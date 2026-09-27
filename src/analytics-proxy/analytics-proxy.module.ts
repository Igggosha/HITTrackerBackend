import { Module } from '@nestjs/common';
import { AnalyticsProxyController } from './analytics-proxy.controller';
import { AnalyticsProxyService } from './analytics-proxy.service';

@Module({
  controllers: [AnalyticsProxyController],
  providers: [AnalyticsProxyService],
})
export class AnalyticsProxyModule {}
