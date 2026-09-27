import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import { withReplicas } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { relations } from './relations';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const primaryDb = drizzle({
  client: pool,
  relations,
});

const replicaPool = process.env.DATABASE_REPLICA_URL
  ? new Pool({ connectionString: process.env.DATABASE_REPLICA_URL })
  : null;

export const db = replicaPool
  ? withReplicas(primaryDb, [drizzle({ client: replicaPool, relations })])
  : primaryDb;
