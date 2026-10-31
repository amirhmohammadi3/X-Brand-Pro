import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS, type RedisLike } from './redis.client.js';

/**
 * JSON cache over Redis. Every value has a TTL (no forever keys — a stale
 * cache must always age out). All failures degrade to a cache MISS so a
 * Redis outage never breaks a request path that only uses the cache for
 * speed. Key layout: `<global prefix>cache:<key>` (the global prefix is
 * applied by RedisService).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS) private readonly redis: RedisLike) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.k(key));
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(
        `cache get failed (degrading to miss): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    try {
      await this.redis.set(this.k(key), JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
      this.logger.warn(
        `cache set failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(this.k(key));
    } catch (err) {
      this.logger.warn(
        `cache del failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Read-through helper: returns the cached value or produces, stores and
   * returns it. Concurrent misses may both produce (stampede); acceptable at
   * current scale — a single-flight lock is a recorded follow-up.
   */
  async wrap<T>(key: string, ttlSec: number, produce: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await produce();
    await this.set(key, value, ttlSec);
    return value;
  }

  private k(key: string): string {
    return `cache:${key}`;
  }
}
