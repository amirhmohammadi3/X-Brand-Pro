import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PoolConfig } from 'pg';
import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '../src/config/config.module.js';
import { DrizzleClient, DRIZZLE_POOL } from '../src/db/drizzle.client.js';
import { DrizzleModule } from '../src/db/drizzle.module.js';

// Required env keys that have no defaults (see src/config/env.ts).
const TEST_DB_URL = 'postgres://app:app_dev_password@localhost:5432/app_test';
const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PUBLIC_WEB_URL: 'http://localhost:3100',
  DATABASE_URL: TEST_DB_URL,
  TEST_DATABASE_URL: TEST_DB_URL,
  REDIS_URL: 'redis://localhost:6379/15',
  TEST_REDIS_URL: 'redis://localhost:6379/15',
  // B1.3 auth keys (required by the env schema; values are test-only).
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef0123456789abcdef',
  OTP_HMAC_SECRET: 'test-otp-hmac-secret-0123456789abcdef0123456789',
};

describe('DrizzleModule (B0.2)', () => {
  let ctx: INestApplicationContext | undefined;

  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('exposes a lazy pg Pool and a DrizzleClient without contacting the database', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(BASE_ENV), DrizzleModule],
    }).compile();
    ctx = moduleRef;

    const pool = moduleRef.get<Pool>(DRIZZLE_POOL);
    expect(pool).toBeInstanceOf(Pool);

    const client = moduleRef.get(DrizzleClient);
    expect(client.db).toBeDefined();
    expect(typeof client.db.select).toBe('function');
    expect(typeof client.db.insert).toBe('function');
  });

  it('builds the pool from AppConfig.databaseUrl', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(BASE_ENV), DrizzleModule],
    }).compile();
    ctx = moduleRef;

    const pool = moduleRef.get<Pool>(DRIZZLE_POOL);
    const options = pool.options as PoolConfig;
    expect(options.connectionString).toBe(BASE_ENV.DATABASE_URL);
  });

  it('applies sane pool defaults and lets overrides win', async () => {
    const { createPool } = await import('../src/db/drizzle.client.js');
    const pool = createPool(TEST_DB_URL, { max: 3 });
    try {
      expect((pool.options as PoolConfig).max).toBe(3);
    } finally {
      await pool.end();
    }
  });

  it('ends the pool when the application shuts down', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(BASE_ENV), DrizzleModule],
    }).compile();
    ctx = moduleRef;

    const pool = moduleRef.get<Pool>(DRIZZLE_POOL);
    const endSpy = vi.spyOn(pool, 'end').mockResolvedValue(undefined as never);
    const client = moduleRef.get(DrizzleClient);

    await client.onApplicationShutdown();
    expect(endSpy).toHaveBeenCalledOnce();
  });
});
