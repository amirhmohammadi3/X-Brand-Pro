import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export const DRIZZLE_POOL = Symbol('DRIZZLE_POOL');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

/** Drizzle database handle bound to the pg pool (includes the relational query API). */
export type DrizzleDb = NodePgDatabase<typeof schema>;

const DEFAULT_POOL_CONFIG: PoolConfig = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

/**
 * Build a pg pool for the given connection string. pg pools connect lazily —
 * creating one never opens a socket, so tests can instantiate the DI graph
 * without a live database.
 */
export function createPool(databaseUrl: string, overrides: PoolConfig = {}): Pool {
  return new Pool({ ...DEFAULT_POOL_CONFIG, connectionString: databaseUrl, ...overrides });
}

export function createDb(pool: Pool): DrizzleDb {
  return drizzle(pool, { schema });
}

/**
 * Owns the pg pool lifecycle for the app. Inject `DrizzleClient` (class token)
 * and use `client.db`; inject `DRIZZLE_POOL` only for raw `pool.query` needs
 * (extensions DDL, COPY, LISTEN). On application shutdown the pool is ended so
 * tests and processes exit cleanly.
 */
@Injectable()
export class DrizzleClient implements OnApplicationShutdown {
  readonly db: DrizzleDb;

  constructor(@Inject(DRIZZLE_POOL) private readonly pool: Pool) {
    this.db = createDb(pool);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
