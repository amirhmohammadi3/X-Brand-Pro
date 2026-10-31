import type { RedisLike } from '../src/redis/redis.client.js';

type Entry = { value: string; expiresAt: number | null };

/**
 * In-memory RedisLike for unit tests — implements exactly the subset the
 * services use, honoring wall-clock expiry (so vi.useFakeTimers +
 * setSystemTime drive both expiry and limiter windows).
 */
export class FakeRedis implements RedisLike {
  store = new Map<string, Entry>();

  private live(key: string): Entry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, mode: 'EX', ttlSec: number): Promise<unknown> {
    if (mode !== 'EX') throw new Error(`FakeRedis.set: unsupported mode ${mode}`);
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const next = (current === null ? 0 : Number.parseInt(current, 10)) + 1;
    const existing = this.store.get(key);
    // INCR preserves the existing TTL (none is set by incr itself).
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number, mode: 'NX'): Promise<unknown> {
    if (mode !== 'NX') throw new Error(`FakeRedis.expire: unsupported mode ${mode}`);
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.expiresAt !== null) return 0; // NX: TTL already set
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const left = Math.ceil((entry.expiresAt - Date.now()) / 1000);
    return left > 0 ? left : -2;
  }
}
