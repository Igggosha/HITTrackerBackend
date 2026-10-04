import {
  RedisThrottlerStorage,
  RedisEvalClient,
} from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  const evalMock = jest.fn<
    Promise<unknown>,
    [string, { keys: string[]; arguments: string[] }]
  >();
  const redis: RedisEvalClient = { eval: evalMock };
  const storage = new RedisThrottlerStorage(redis);

  beforeEach(() => evalMock.mockReset());

  it('returns the first hit and its window TTL in seconds', async () => {
    evalMock.mockResolvedValue([1, 60, 0, 0]);
    await expect(
      storage.increment('client', 60_000, 5, 30_000, 'default'),
    ).resolves.toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(evalMock.mock.calls[0][1]).toEqual({
      keys: [
        'hit-tracker:throttler:default:client:count',
        'hit-tracker:throttler:default:client:blocked',
      ],
      arguments: ['60', '5', '30'],
    });
  });

  it('returns the block state and block TTL when the limit is crossed', async () => {
    evalMock.mockResolvedValue(['6', '60', '1', '30']);
    await expect(
      storage.increment('client', 60_000, 5, 30_000, 'default'),
    ).resolves.toMatchObject({
      totalHits: 6,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });

  it('preserves an already-blocked response from Redis', async () => {
    evalMock.mockResolvedValue([6, 42, 1, 17]);
    await expect(
      storage.increment('client', 60_000, 5, 30_000, 'default'),
    ).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 42,
      isBlocked: true,
      timeToBlockExpire: 17,
    });
  });

  it('converts millisecond durations to ceiling seconds', async () => {
    evalMock.mockResolvedValue([1, 2, 0, 0]);
    await storage.increment('client', 1_001, 1, 2_001, 'short');
    expect(evalMock.mock.calls[0][1].arguments).toEqual(['2', '1', '3']);
  });

  it('propagates Redis errors', async () => {
    const error = new Error('redis unavailable');
    evalMock.mockRejectedValue(error);
    await expect(
      storage.increment('client', 1000, 1, 1000, 'default'),
    ).rejects.toBe(error);
  });
});
