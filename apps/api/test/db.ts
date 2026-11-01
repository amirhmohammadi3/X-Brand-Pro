import { spawnSync } from 'node:child_process';
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

/**
 * Synchronous reachability probe for collection-time gating: top-level
 * `await` is not allowed under the project's CommonJS tsconfig, so suites
 * that want a REAL skip (not just an env-var check) call this in
 * `describe.skipIf(...)`. Spawns a 1.5 s TCP connect attempt.
 */
export function databaseReachableSync(timeoutMs = 1_500): boolean {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return false;
  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
    port = Number(parsed.port || 5432);
  } catch {
    return false;
  }
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `const net=require('net');const s=net.connect(${port},'${host}');` +
        `s.on('connect',()=>{s.destroy();process.exit(0)});` +
        `s.on('error',()=>process.exit(1));` +
        `setTimeout(()=>process.exit(1),${timeoutMs})`,
    ],
    { stdio: 'ignore', timeout: timeoutMs + 2_000 },
  );
  const ok = result.status === 0;
  if (!ok) {
    console.warn(
      `[test] PostgreSQL not reachable at ${host}:${port} — database suites will be skipped. ` +
        'Start the stack (pnpm services:up) to run them.',
    );
  }
  return ok;
}
