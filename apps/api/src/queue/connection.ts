import type { ConnectionOptions } from 'bullmq';

/**
 * BullMQ Workers use blocking connections, which REQUIRE
 * `maxRetriesPerRequest: null` (BullMQ refuses to start a worker otherwise).
 * Queues share the same plain-options shape. Plain objects (not ioredis
 * instances) are passed on purpose: BullMQ then owns its connections'
 * lifecycle, and plain options cannot break across driver majors.
 */
export const BLOCKING_CONNECTION_DEFAULTS = { maxRetriesPerRequest: null } as const;

/**
 * Parse a redis:// URL into BullMQ connection options.
 * Supports redis:// and rediss:// (TLS), optional username/password, and a
 * /N database suffix. Throws a readable error on malformed URLs — fail fast
 * at boot instead of mis-routing jobs.
 */
export function parseRedisUrl(rawUrl: string): ConnectionOptions {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `Invalid REDIS_URL "${mask(rawUrl)}" — expected redis://[:password@]host:port[/db]`,
    );
  }
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Invalid REDIS_URL protocol "${url.protocol}" — use redis: or rediss:`);
  }
  const dbParam = url.pathname.replace(/^\//, '');
  const options: ConnectionOptions = {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number(url.port),
    ...BLOCKING_CONNECTION_DEFAULTS,
  };
  if (url.protocol === 'rediss:') options.tls = {};
  if (url.username && url.username !== 'default') options.username = url.username;
  if (url.password) options.password = url.password;
  if (dbParam !== '') {
    const db = Number(dbParam);
    if (!Number.isInteger(db) || db < 0) {
      throw new Error(`Invalid REDIS_URL database "${dbParam}" — must be a non-negative integer`);
    }
    options.db = db;
  }
  return options;
}

/** Never log credentials: replace the password part of a URL. */
export function mask(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(unparseable url)';
  }
}
