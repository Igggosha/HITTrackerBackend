import { GUARDS_METADATA } from '@nestjs/common/constants';
import { pool } from '../db/db';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { MINIMUM_ROLE_KEY } from '../auth/minimum-role.decorator';
import { CatalogSearchController } from './catalog-search.controller';
import { CatalogSearchService } from './catalog-search.service';

jest.mock('../db/db', () => ({ pool: { query: jest.fn() } }));

const storage = { getUrl: jest.fn().mockResolvedValue(null) };
const metrics = {
  searchRequests: { inc: jest.fn() },
  searchDuration: { observe: jest.fn() },
};
const dto = {
  q: 'strength',
  section: 'programs' as const,
  scope: 'all' as const,
  sort: 'relevance' as const,
  locale: 'en' as const,
  limit: 25,
};

describe('catalog search access', () => {
  it('requires the standard authenticated user guards', () => {
    expect(Reflect.getMetadata(MINIMUM_ROLE_KEY, CatalogSearchController)).toBe(
      'user',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CatalogSearchController),
    ).toEqual([JwtGuard, RolesGuard]);
  });
});

describe('CatalogSearchService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the stable 503 fallback contract when Elasticsearch is disabled', async () => {
    const service = new CatalogSearchService(
      null,
      storage as any,
      metrics as any,
    );
    await expect(service.search(7, dto)).rejects.toMatchObject({
      response: { code: 'SEARCH_UNAVAILABLE' },
    });
    expect(metrics.searchRequests.inc).toHaveBeenCalledWith({
      result: 'error',
    });
  });

  it('uses Elasticsearch only for ranking and reapplies ownership in PostgreSQL', async () => {
    const client = {
      search: jest.fn().mockResolvedValue({
        hits: {
          hits: [
            { _id: '8', sort: [2, 8] },
            { _id: '3', sort: [1, 3] },
          ],
        },
      }),
    };
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: 8,
          name: 'Mine',
          description: null,
          videoUrl: null,
          imageKey: null,
          isPersonal: true,
          createdAt: new Date('2026-09-29T00:00:00Z'),
          ownerUsername: 'owner',
          createdById: 7,
          likesCount: 0,
          isLiked: false,
          isScheduled: false,
          schedule: [],
        },
      ],
    } as any);
    const service = new CatalogSearchService(
      client as any,
      storage as any,
      metrics as any,
    );

    await expect(service.search(7, dto)).resolves.toMatchObject({
      items: [{ id: 8, name: 'Mine' }],
      nextCursor: null,
      fallback: false,
    });
    const [sql, values] = jest.mocked(pool.query).mock.calls[0];
    expect(sql).toContain('p.is_personal = true and p.created_by_id = $2');
    expect(values).toEqual([[8, 3], 7]);
  });
});
