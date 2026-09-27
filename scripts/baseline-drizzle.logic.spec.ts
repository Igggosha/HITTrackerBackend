import {
  fingerprintedMigrations,
  migrationTimestamp,
  recordMigrationIfMissing,
  type QueryableClient,
} from './baseline-drizzle.logic';

function fakeClient(rows: Record<string, unknown>[]): QueryableClient {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

describe('migrationTimestamp', () => {
  it('parses a migration folder name into its UTC creation time', () => {
    expect(
      migrationTimestamp('20260924090000_add_body_metrics_analytics'),
    ).toBe(Date.UTC(2026, 8, 24, 9, 0, 0));
  });
});

describe('recordMigrationIfMissing', () => {
  it('hashes the migration file and inserts a conditional row keyed by name', async () => {
    const client = fakeClient([{ id: 1 }]);

    const inserted = await recordMigrationIfMissing(
      client,
      '20260810115352_robust_leopardon',
    );

    expect(inserted).toBe(true);
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (client.query as jest.Mock).mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sql).toContain('insert into drizzle.__drizzle_migrations');
    expect(sql).toContain('where not exists');
    expect(params).toEqual([
      expect.any(String),
      migrationTimestamp('20260810115352_robust_leopardon'),
      '20260810115352_robust_leopardon',
    ]);
  });

  it('returns false when a row for the migration already exists', async () => {
    const client = fakeClient([]);

    await expect(
      recordMigrationIfMissing(client, '20260810115352_robust_leopardon'),
    ).resolves.toBe(false);
  });
});

describe('fingerprintedMigrations: 20260924090000_add_body_metrics_analytics', () => {
  const fingerprint = fingerprintedMigrations.find(
    (migration) =>
      migration.name === '20260924090000_add_body_metrics_analytics',
  );

  it('is registered', () => {
    expect(fingerprint).toBeDefined();
  });

  it('reports applied when the column, check constraint, and index all exist', async () => {
    const client = fakeClient([{ present: true }]);

    await expect(fingerprint!.isAlreadyApplied(client)).resolves.toBe(true);
  });

  it('reports not applied when the fingerprint query finds a gap', async () => {
    const client = fakeClient([{ present: false }]);

    await expect(fingerprint!.isAlreadyApplied(client)).resolves.toBe(false);
  });

  it('reports not applied when the query returns no row', async () => {
    const client = fakeClient([]);

    await expect(fingerprint!.isAlreadyApplied(client)).resolves.toBe(false);
  });
});
