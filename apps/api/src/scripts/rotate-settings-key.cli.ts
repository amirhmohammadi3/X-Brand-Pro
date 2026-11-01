import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { rotateSettingsKey } from './rotate-settings-key.js';

/**
 * CLI wrapper (I1.1). The testable logic lives in rotate-settings-key.ts;
 * this entrypoint resolves the repo root (walks up to .env.example), loads
 * .env, and runs the rotation with the current + NEW encryption keys.
 *
 * Usage (app STOPPED):
 *   SETTINGS_ENCRYPTION_KEY_NEW='<32+ chars>' \
 *     pnpm --filter @app/api exec tsx src/scripts/rotate-settings-key.cli.ts
 */

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, '.env.example'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function loadEnvFile(): void {
  const envPath = path.join(repoRoot(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || match[1] === undefined) continue;
    const key = match[1];
    const value = match[2] ?? '';
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1].replace(/\\/g, '/').includes('rotate-settings-key');

if (isDirectRun) {
  loadEnvFile();
  const oldKey = process.env.SETTINGS_ENCRYPTION_KEY;
  const newKey = process.env.SETTINGS_ENCRYPTION_KEY_NEW;
  const databaseUrl = process.env.DATABASE_URL;
  if (!oldKey || !newKey) {
    console.error(
      'Both SETTINGS_ENCRYPTION_KEY (current) and SETTINGS_ENCRYPTION_KEY_NEW are required',
    );
    process.exit(1);
  }
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  rotateSettingsKey(pool, oldKey, newKey)
    .then(async () => {
      await pool.end();
      console.log('Now update SETTINGS_ENCRYPTION_KEY in .env to the NEW value and start the app.');
    })
    .catch(async (error: unknown) => {
      await pool.end().catch(() => undefined);
      console.error(
        '[rotate-settings-key] FAILED (nothing was written):',
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
}
