const pools: Array<{ connectionString: string | undefined }> = [];

jest.mock('pg', () => ({
  Pool: jest
    .fn()
    .mockImplementation((options: { connectionString?: string }) => {
      const pool = { connectionString: options.connectionString };
      pools.push(pool);
      return pool;
    }),
}));

jest.mock('drizzle-orm/node-postgres', () => ({
  drizzle: jest.fn(({ client }: { client: { connectionString?: string } }) => ({
    select: () => client.connectionString,
    insert: () => client.connectionString,
    transaction: () => client.connectionString,
  })),
}));

describe('database routing', () => {
  const originalPrimary = process.env.DATABASE_URL;
  const originalReplica = process.env.DATABASE_REPLICA_URL;

  afterEach(() => {
    process.env.DATABASE_URL = originalPrimary;
    if (originalReplica === undefined) delete process.env.DATABASE_REPLICA_URL;
    else process.env.DATABASE_REPLICA_URL = originalReplica;
    pools.length = 0;
    jest.resetModules();
  });

  it('uses one primary pool without a replica URL', () => {
    process.env.DATABASE_URL = 'postgresql://primary/app';
    delete process.env.DATABASE_REPLICA_URL;
    const { db, primaryDb, pool } =
      jest.requireActual<typeof import('./db')>('./db');
    expect(pools).toHaveLength(1);
    expect(pool).toBe(pools[0]);
    expect(db).toBe(primaryDb);
    expect(db.select()).toBe('postgresql://primary/app');
  });

  it('routes selects to the replica and writes and transactions to primary', () => {
    process.env.DATABASE_URL = 'postgresql://primary/app';
    process.env.DATABASE_REPLICA_URL = 'postgresql://replica/app';
    const { db, primaryDb, pool } =
      jest.requireActual<typeof import('./db')>('./db');
    expect(pools).toHaveLength(2);
    expect(pool).toBe(pools[0]);
    expect(db.select()).toBe('postgresql://replica/app');
    expect((db.insert as unknown as () => string)()).toBe(
      'postgresql://primary/app',
    );
    expect((db.transaction as unknown as () => string)()).toBe(
      'postgresql://primary/app',
    );
    expect(primaryDb.select()).toBe('postgresql://primary/app');
  });
});
