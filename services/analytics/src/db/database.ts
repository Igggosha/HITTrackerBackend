import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
export type AnalyticsDb = NodePgDatabase;

export const PG_POOL = Symbol('PG_POOL');
export const ANALYTICS_DB = Symbol('ANALYTICS_DB');

export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.ANALYTICS_DB_POOL_MAX ?? 10),
    connectionTimeoutMillis: 5_000,
    // Bounds every statement; a stuck query becomes an ordinary (transient)
    // failure that the consumer retries with backoff.
    statement_timeout: 10_000,
  });
  const logger = new Logger('PgPool');
  // An idle client losing its connection (PostgreSQL restart) must not crash
  // the process; the next query simply gets a new connection.
  pool.on('error', (error) =>
    logger.warn(`idle PostgreSQL client error: ${error.message}`),
  );
  return pool;
}

export function createDb(pool: Pool): AnalyticsDb {
  return drizzle({ client: pool });
}

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => createPool(process.env.ANALYTICS_DATABASE_URL!),
    },
    { provide: ANALYTICS_DB, useFactory: createDb, inject: [PG_POOL] },
    PoolCloser,
  ],
  exports: [PG_POOL, ANALYTICS_DB],
})
export class DatabaseModule {}
