import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './db/database';

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness + database reachability, for the Compose healthcheck. */
  @Get('health')
  async health() {
    try {
      await this.pool.query('select 1');
    } catch {
      throw new ServiceUnavailableException({
        message: 'Analytics database unavailable',
        code: 'ANALYTICS_DB_UNAVAILABLE',
      });
    }
    return { status: 'ok' };
  }
}
