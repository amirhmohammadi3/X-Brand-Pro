import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheService } from '../src/redis/cache.service.js';
import { FakeRedis } from './fake-redis.js';

describe('CacheService (B0.3)', () => {
  let cache: CacheService;
  let fake: FakeRedis;

  beforeEach(() => {
    fake = new FakeRedis();
    cache = new CacheService(fake);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and reads JSON values (roundtrip)', async () => {
    await cache.set('search:hot', [{ q: 'pizza' }], 60);
    expect(await cache.get<Array<{ q: string }>>('search:hot')).toEqual([{ q: 'pizza' }]);
  });

  it('returns null on a miss', async () => {
    expect(await cache.get('nope')).toBeNull();
  });

  it('expires entries after their TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    await cache.set('k', 'v', 30);
    expect(await cache.get('k')).toBe('v');
    vi.setSystemTime(new Date('2026-10-31T12:01:00Z')); // +60s > ttl 30s
    expect(await cache.get('k')).toBeNull();
  });

  it('wrap() produces once and serves the cached value afterwards', async () => {
    const producer = vi.fn(async () => ({ n: 42 }));
    expect(await cache.wrap('w', 60, producer)).toEqual({ n: 42 });
    expect(await cache.wrap('w', 60, producer)).toEqual({ n: 42 });
    expect(producer).toHaveBeenCalledOnce();
  });

  it('wrap() re-produces after del()', async () => {
    const producer = vi.fn(async () => 'fresh');
    await cache.wrap('w', 60, producer);
    await cache.del('w');
    expect(await cache.wrap('w', 60, producer)).toBe('fresh');
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it('degrades to a miss when the stored payload is corrupt', async () => {
    await fake.set('cache:broken', '{not json', 'EX', 60);
    expect(await cache.get('broken')).toBeNull();
  });

  it('never throws when the backend fails (fail-open reads and writes)', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      del: async () => {
        throw new Error('down');
      },
      incr: async () => {
        throw new Error('down');
      },
      expire: async () => {
        throw new Error('down');
      },
      ttl: async () => {
        throw new Error('down');
      },
      lpush: async () => {
        throw new Error('down');
      },
      ltrim: async () => {
        throw new Error('down');
      },
      lrange: async () => {
        throw new Error('down');
      },
    };
    const failing = new CacheService(broken);
    await expect(failing.get('k')).resolves.toBeNull();
    await expect(failing.set('k', 1, 10)).resolves.toBeUndefined();
    await expect(failing.del('k')).resolves.toBeUndefined();
    // wrap still returns the produced value when the backend is down.
    await expect(failing.wrap('k', 10, async () => 'ok')).resolves.toBe('ok');
  });
});
