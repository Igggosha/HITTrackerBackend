import type { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { db } from '../db/db';
import { UsersService } from './users.service';

jest.mock('../db/db', () => ({ db: {} }));

describe('UsersService body metrics validation', () => {
  const service = new UsersService(new ConfigService(), {} as StorageService);

  it('returns the required code when no metric is provided', async () => {
    await expect(service.createBodyMetric(1, {})).rejects.toMatchObject({
      response: { code: 'BODY_METRIC_REQUIRED' },
      status: 400,
    });
  });

  it('returns range details and rejects future dates with stable codes', async () => {
    await expect(
      service.createBodyMetric(1, { weight: 19 }),
    ).rejects.toMatchObject({
      response: {
        code: 'BODY_METRIC_OUT_OF_RANGE',
        details: [{ field: 'weight', code: 'OUT_OF_RANGE', min: 20, max: 400 }],
      },
    });

    await expect(
      service.createBodyMetric(1, {
        waistCircumference: 74,
        recordedAt: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
      }),
    ).rejects.toMatchObject({
      response: { code: 'BODY_METRIC_FUTURE_DATE' },
    });
  });

  it('rejects reversed and overlong periods before querying the database', async () => {
    await expect(
      service.getBodyMetrics(1, {
        from: '2026-08-28T00:00:00.000Z',
        to: '2026-08-20T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PERIOD' } });
    await expect(
      service.getBodyMetrics(1, {
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-02-06T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PERIOD' } });
    expect(db).not.toHaveProperty('select');
  });
});
