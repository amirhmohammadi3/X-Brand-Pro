import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * The narrow Redis surface used by this app's services. Deliberately small so
 * tests can substitute an in-memory fake, and so swapping the driver later
 * cannot ripple through the codebase. Methods map 1:1 to Redis commands.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  /** `EXPIRE key seconds NX` — sets TTL only when the key has none (Redis >= 7). */
  expire(key: string, seconds: number, mode: 'NX'): Promise<unknown>;
  /** -2 missing key, -1 no expiry, otherwise seconds left. */
  ttl(key: string): Promise<number>;
}

const LOG_SILENT = (): void => undefined;

/**
 * ioredis-backed RedisLike with a global key prefix so the app can share a
 * Redis DB with other software without key collisions. The connection is
 * LAZY: creating the service never opens a socket, and a missing Redis must
 * not crash boot (cache/limiter services degrade gracefully — see their
 * error handling). The noop 'error' listener keeps ioredis's reconnect loop
 * from becoming an unhandled 'error' event when Redis is down.
 */
@Injectable()
export class RedisService implements RedisLike, OnApplicationShutdown {
  readonly redis: Redis;

  constructor(connectionString: string, keyPrefix = 'xbrand:') {
    this.redis = new Redis(connectionString, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5_000),
      keyPrefix,
    });
    this.redis.on('error', LOG_SILENT);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  set(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown> {
    return this.redis.set(key, value, mode, ttlSec);
  }

  del(...keys: string[]): Promise<number> {
    return this.redis.del(...keys);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  expire(key: string, seconds: number, mode: 'NX'): Promise<unknown> {
    return this.redis.expire(key, seconds, mode);
  }

  ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async onApplicationShutdown(): Promise<void> {
    // Never rejects: force-disconnect regardless of pending commands.
    this.redis.disconnect();
  }
}
