import net from 'node:net';
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
 */
export async function prepareTestDatabase(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  await migrateDatabase(url, resolveMigrationsFolder());
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
