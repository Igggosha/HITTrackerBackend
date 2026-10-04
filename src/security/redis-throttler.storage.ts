import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

export interface RedisEvalClient {
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown>;
}

const INCREMENT_SCRIPT = `
local blocked = redis.call('EXISTS', KEYS[2])
if blocked == 1 then
  return { redis.call('GET', KEYS[1]) or 0, redis.call('TTL', KEYS[1]), 1, redis.call('TTL', KEYS[2]) }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local blockTtl = 0
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
  blockTtl = tonumber(ARGV[3])
end
return { hits, redis.call('TTL', KEYS[1]), blockTtl > 0 and 1 or 0, blockTtl }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly prefix = 'hit-tracker:throttler',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const namespace = `${this.prefix}:${throttlerName}:${key}`;
    const windowSeconds = Math.max(1, Math.ceil(ttl / 1000));
    const blockSeconds = Math.max(1, Math.ceil(blockDuration / 1000));
    const result = (await this.redis.eval(INCREMENT_SCRIPT, {
      keys: [`${namespace}:count`, `${namespace}:blocked`],
      arguments: [String(windowSeconds), String(limit), String(blockSeconds)],
    })) as [number | string, number | string, number | string, number | string];

    return {
      totalHits: Number(result[0]),
      timeToExpire: Math.max(0, Number(result[1])),
      isBlocked: Number(result[2]) === 1,
      timeToBlockExpire: Math.max(0, Number(result[3])),
    };
  }
}
