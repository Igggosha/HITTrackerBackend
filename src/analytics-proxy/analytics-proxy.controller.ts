import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import type { RequestWithId } from '../common/request-id';
import { AnalyticsProxyService } from './analytics-proxy.service';

/**
 * `GET /analytics/*` -> analytics service. JwtGuard rejects anonymous calls
 * here already (and keeps the global throttler in front of the read side);
 * the analytics service still verifies the same token on its own.
 */
@UseGuards(JwtGuard)
@Controller('analytics')
export class AnalyticsProxyController {
  constructor(private readonly proxy: AnalyticsProxyService) {}

  @Get('*path')
  async forward(@Req() request: RequestWithId, @Res() response: Response) {
    const upstream = await this.proxy.forward(request.originalUrl, {
      authorization: request.headers.authorization,
      requestId: request.id,
    });
    response
      .status(upstream.status)
      .type(upstream.contentType)
      .setHeader('Cache-Control', 'no-store');
    response.send(upstream.body);
  }
}
