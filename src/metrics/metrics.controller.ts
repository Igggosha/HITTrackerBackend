import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @SkipThrottle()
  async scrape(
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!this.metrics.authorized(authorization))
      throw new UnauthorizedException();
    response
      .type(this.metrics.registry.contentType)
      .send(await this.metrics.metrics());
  }
}
