#!/usr/bin/env node
// CLI: apply drizzle migrations + ensure required extensions.
// Usage: node dist/src/migrate.js [--test]
//   (no flag)  -> DATABASE_URL
//   --test     -> TEST_DATABASE_URL
// Never prints the connection URL (it contains credentials).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { loadEnv } from '../config/env.js';
import { loadDotenvIntoProcessEnv } from './load-dotenv.js';

/**
 * Extensions every environment must have before any table exists. Kept in
 * code (not in a drizzle-kit migration) because drizzle-kit cannot snapshot
 * extension DDL; they are idempotent (`IF NOT EXISTS`) and safe to re-run.
 * `pgcrypto` provides gen_random_uuid() used by every primary key.
 */
export const REQUIRED_EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'pgcrypto'] as const;

export async function ensureExtensions(pool: Pool): Promise<void> {
  for (const ext of REQUIRED_EXTENSIONS) {
    // ext comes from the REQUIRED_EXTENSIONS constant, never from user input.
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
  }
}

export async function migrateDatabase(
  databaseUrl: string,
  migrationsFolder: string,
): Promise<void> {
  const { createPool } = await import('./drizzle.client.js');
  const pool = createPool(databaseUrl);
  try {
    await ensureExtensions(pool);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/**
 * Migrations live in apps/api/drizzle. Resolved relative to THIS file so both
 * layouts work: compiled (dist/src/db/migrate.js -> 3 ups) and source/test
 * (src/db/migrate.ts or test/ -> 2 ups). Falls back to cwd-relative for
 * exotic runners, then throws with the searched paths.
 */
export function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'drizzle'), // dist/src/db/
    path.resolve(__dirname, '..', '..', 'drizzle'), // src/db/ and test/
    path.resolve(process.cwd(), 'drizzle'), // cwd = apps/api
    path.resolve(process.cwd(), 'apps', 'api', 'drizzle'), // cwd = repo root
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`drizzle migrations folder not found; searched:\n${candidates.join('\n')}`);
}

async function main(): Promise<void> {
  loadDotenvIntoProcessEnv();
  const env = loadEnv();
  const useTest = process.argv.includes('--test');
  const url = useTest ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  const target = useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  process.stdout.write(`[db:migrate] target=${target} folder=${resolveMigrationsFolder()}\n`);
  await migrateDatabase(url, resolveMigrationsFolder());
  process.stdout.write('[db:migrate] done\n');
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[db:migrate] failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
