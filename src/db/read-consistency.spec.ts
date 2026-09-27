const REPLICA = { marker: 'replica' };
const PRIMARY = { marker: 'primary' };

jest.mock('./db', () => ({
  db: REPLICA,
  primaryDb: PRIMARY,
}));

import {
  _resetReadConsistencyForTests,
  _trackedUserCountForTests,
  readerFor,
  recordWrite,
} from './read-consistency';

describe('read-consistency', () => {
  afterEach(() => {
    _resetReadConsistencyForTests();
  });

  it('routes a user who has not written anywhere to the replica', () => {
    expect(readerFor(1, 1_000)).toBe(REPLICA);
  });

  it('routes a user to the primary immediately after their write', () => {
    recordWrite(1, 1_000);
    expect(readerFor(1, 1_000)).toBe(PRIMARY);
  });

  it('keeps routing to the primary for the rest of the window', () => {
    recordWrite(1, 1_000);
    expect(readerFor(1, 1_000 + 4_999)).toBe(PRIMARY);
  });

  it('falls back to the replica once the window has fully elapsed', () => {
    recordWrite(1, 1_000);
    expect(readerFor(1, 1_000 + 5_000)).toBe(REPLICA);
  });

  it('isolates the write window per user', () => {
    recordWrite(1, 1_000);
    expect(readerFor(2, 1_000)).toBe(REPLICA);
    expect(readerFor(1, 1_000)).toBe(PRIMARY);
  });

  it('extends the window on a second write by the same user', () => {
    recordWrite(1, 1_000);
    recordWrite(1, 4_000);
    // Would have expired relative to the first write (1000 + 5000 = 6000)
    // but the second write at 4000 extends primary routing to 9000.
    expect(readerFor(1, 6_500)).toBe(PRIMARY);
    expect(readerFor(1, 9_000)).toBe(REPLICA);
  });

  it('sweeps expired entries once the tracked-user bound is exceeded', () => {
    for (let userId = 0; userId < 10_001; userId += 1) {
      recordWrite(userId, 1_000);
    }
    // Below/at the bound-triggering insert, nothing is stale relative to
    // itself yet, so the sweep this insert may have triggered removed nothing.
    expect(_trackedUserCountForTests()).toBe(10_001);

    // One more write, well past the window for everyone recorded above,
    // pushes the map size past the bound again and triggers a sweep.
    recordWrite(20_000, 1_000 + 6_000);

    expect(_trackedUserCountForTests()).toBe(1);
    expect(readerFor(0, 1_000 + 6_000)).toBe(REPLICA);
    expect(readerFor(20_000, 1_000 + 6_000)).toBe(PRIMARY);
  });
});
