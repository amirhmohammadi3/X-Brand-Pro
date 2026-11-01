import net from 'node:net';
import { Pool } from 'pg';
import { migrateDatabase, resolveMigrationsFolder } from '../src/db/migrate.js';

/**
 * Integration-test database helpers (Q0.1).
 *
 * `prepareTestDatabase()` applies extensions + migrations to TEST_DATABASE_URL
 * — call it from an integration suite's beforeAll. It requires a live
 * Postgres (Docker: `pnpm services:up`).
 *
 * `databaseAvailable()` probes the test DB first so suites can
 * `describe.skipIf(!(await databaseAvailable()))(...)` — CI and sandboxes
 * WITHOUT services stay green, machines with Docker run the full suite.
 *
 * `migrateTestDb()` / `getTestPool()` / `closeTestDb()` (B1.11) back the
 * audit integration suite, which needs a raw pg Pool to scan/seed audit_logs
 * alongside the DrizzleClient the app owns. The pool is a singleton so every
 * helper shares one connection set, closed once in afterAll.
 */

let testPool: Pool | null = null;

export async function prepareTestDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  await migrateDatabase(url, resolveMigrationsFolder());
}

/** Apply migrations to the test DB (alias used by the audit suite). */
export async function migrateTestDb(): Promise<void> {
  await prepareTestDatabase();
}

/** Singleton pg Pool on TEST_DATABASE_URL for raw SQL in tests. */
export function getTestPool(): Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (!testPool) testPool = new Pool({ connectionString: url, max: 5 });
  return testPool;
}

/** Close the singleton pool (call from afterAll of the suite that opened it). */
export async function closeTestDb(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

/** True when a TCP connect to the Postgres port succeeds within timeoutMs. */
export async function databaseAvailable(timeoutMs = 1_500): Promise<boolean> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return await probeSocket(parsed.hostname, Number(parsed.port || 5432), timeoutMs);
  } catch {
    return false;
  }
}

function probeSocket(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}
