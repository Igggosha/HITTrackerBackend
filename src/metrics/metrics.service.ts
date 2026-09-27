import { Injectable } from '@nestjs/common';
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../db/db';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled by the API.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  readonly duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private activeWorkoutsGauge: Gauge<string>;
  private activeWorkouts = 0;
  private activeWorkoutsFetchedAt = 0;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.activeWorkoutsGauge = new Gauge({
      name: 'active_workouts',
      help: 'Workouts currently active.',
      registers: [this.registry],
      collect: async () => {
        if (Date.now() - this.activeWorkoutsFetchedAt > 15_000) {
          try {
            const result = await pool.query<{ count: string }>(
              "select count(*) as count from workouts where status = 'active'",
            );
            this.activeWorkouts = Number(result.rows[0]?.count ?? 0);
            this.activeWorkoutsFetchedAt = Date.now();
          } catch {
            // Keep the last cached value and serve process metrics through outages.
          }
        }
        this.activeWorkoutsGauge.set(this.activeWorkouts);
      },
    });
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  authorized(authorization?: string): boolean {
    const token = process.env.METRICS_TOKEN;
    if (
      !token ||
      token.length < 24 ||
      token === 'change_me' ||
      !authorization?.startsWith('Bearer ')
    )
      return false;
    const supplied = Buffer.from(authorization.slice(7));
    const expected = Buffer.from(token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }
}
