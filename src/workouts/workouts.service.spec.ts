// A minimal drizzle-style chain: every chained method returns another chain
// bound to the same eventual result, and the chain itself is awaitable.
interface QueryChain extends Promise<unknown> {
  from: () => QueryChain;
  where: () => QueryChain;
  limit: () => QueryChain;
  orderBy: () => QueryChain;
  innerJoin: () => QueryChain;
  leftJoin: () => QueryChain;
  set: () => QueryChain;
  returning: () => QueryChain;
}

function chain(result: unknown): QueryChain {
  const promise = Promise.resolve(result);
  return Object.assign(promise, {
    from: () => chain(result),
    where: () => chain(result),
    limit: () => chain(result),
    orderBy: () => chain(result),
    innerJoin: () => chain(result),
    leftJoin: () => chain(result),
    set: () => chain(result),
    returning: () => chain(result),
  });
}

jest.mock('../db/db', () => ({
  db: {
    select: jest.fn(() => chain([])),
    update: jest.fn(() => chain([])),
    insert: jest.fn(() => chain([])),
    delete: jest.fn(() => chain([])),
    transaction: jest.fn(),
  },
  primaryDb: {
    select: jest.fn(() => chain([])),
    update: jest.fn(() => chain([])),
    insert: jest.fn(() => chain([])),
    delete: jest.fn(() => chain([])),
    transaction: jest.fn(),
  },
}));

import { db as realDb, primaryDb as realPrimaryDb } from '../db/db';
import { _resetReadConsistencyForTests } from '../db/read-consistency';
import { WorkoutsService } from './workouts.service';
import type { WorkoutHistoryDatesDto } from './dto/workout.dto';

// The real `db`/`primaryDb` exports are typed as NodePgDatabase, whose
// `select`/`update` are `this`-sensitive methods (unbound-method lint
// territory). The jest.mock above replaces them with plain jest.fn()
// properties at runtime, so re-type them as that once, here.
interface MockedDatabase {
  select: jest.Mock<unknown, unknown[]>;
  update: jest.Mock<unknown, unknown[]>;
  insert: jest.Mock<unknown, unknown[]>;
  delete: jest.Mock<unknown, unknown[]>;
  transaction: jest.Mock<unknown, unknown[]>;
}

const db = realDb as unknown as MockedDatabase;
const primaryDb = realPrimaryDb as unknown as MockedDatabase;
const dbSelect = db.select;
const dbUpdate = db.update;
const primarySelect = primaryDb.select;

describe('WorkoutsService replica/primary read routing', () => {
  const service = new WorkoutsService();
  const dto: WorkoutHistoryDatesDto = {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-02-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    _resetReadConsistencyForTests();
  });

  it('routes a pure browsing history read to the replica when the user has not written recently', async () => {
    dbSelect.mockReturnValueOnce(
      chain([{ finishedAt: new Date('2026-01-15T00:00:00.000Z') }]),
    );

    const dates = await service.getHistoryDates(7, dto);

    expect(dates).toEqual(['2026-01-15T00:00:00.000Z']);
    expect(dbSelect).toHaveBeenCalledTimes(1);
    expect(primarySelect).not.toHaveBeenCalled();
  });

  it('routes the same read to the primary immediately after that user writes', async () => {
    // cancelWorkout: guard read (primaryDb) finds the open workout, then the
    // write (db.update) records it cancelled and marks the user's write time.
    primarySelect.mockReturnValueOnce(
      chain([{ id: 1, userId: 9, finishedAt: null, status: 'active' }]),
    );
    dbUpdate.mockReturnValueOnce(
      chain([{ id: 1, userId: 9, status: 'cancelled' }]),
    );

    await service.cancelWorkout(1, 9);

    jest.clearAllMocks();
    dbSelect.mockReturnValueOnce(chain([]));
    primarySelect.mockReturnValueOnce(chain([]));

    await service.getHistoryDates(9, dto);

    expect(primarySelect).toHaveBeenCalledTimes(1);
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('falls back to the replica again once a different user reads', async () => {
    primarySelect.mockReturnValueOnce(
      chain([{ id: 2, userId: 11, finishedAt: null, status: 'active' }]),
    );
    dbUpdate.mockReturnValueOnce(
      chain([{ id: 2, userId: 11, status: 'cancelled' }]),
    );

    await service.cancelWorkout(2, 11);

    jest.clearAllMocks();
    dbSelect.mockReturnValueOnce(chain([]));

    await service.getHistoryDates(12, dto);

    expect(dbSelect).toHaveBeenCalledTimes(1);
    expect(primarySelect).not.toHaveBeenCalled();
  });
});
