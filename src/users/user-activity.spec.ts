// EN: Verifies deterministic newest-first merging and cursor pagination for administrative user activity from multiple sources.
// UK: Перевіряє детерміноване об'єднання від найновіших подій і cursor-пагінацію адміністративної активності з кількох джерел.

import {
  paginateUserActivity,
  type AdminUserActivityItem,
} from './user-activity';

const item = (id: string, occurredAt: string): AdminUserActivityItem => ({
  id,
  type: 'test',
  category: 'account',
  occurredAt: new Date(occurredAt),
  metadata: {},
});

describe('admin user activity pagination', () => {
  it('merges sources newest-first without duplicating pages', () => {
    const sources = [
      [item('account-1', '2026-09-01T10:00:00Z')],
      [
        item('workout-2', '2026-09-03T10:00:00Z'),
        item('workout-1', '2026-09-02T10:00:00Z'),
      ],
    ];

    expect(paginateUserActivity(sources, 1, 2)).toMatchObject({
      items: [{ id: 'workout-2' }, { id: 'workout-1' }],
      hasMore: true,
    });
    expect(paginateUserActivity(sources, 2, 2)).toMatchObject({
      items: [{ id: 'account-1' }],
      hasMore: false,
    });
  });
});
