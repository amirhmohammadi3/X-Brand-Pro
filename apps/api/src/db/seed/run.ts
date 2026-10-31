#!/usr/bin/env node
// CLI: run idempotent seeders.
// Usage: node dist/src/db/seed/run.js [--test]
// Seeders register themselves via registerSeeder() from their domain module
// seed files (added by later prompts, e.g. B2.10). Every seeder must be
// idempotent: running it twice must not duplicate rows.

import { loadEnv } from '../../config/env.js';
import { loadDotenvIntoProcessEnv } from '../load-dotenv.js';

export type Seeder = {
  /** Stable machine name, e.g. "cities-1". Used for logs and future bookkeeping. */
  name: string;
  /** Must be idempotent (upsert / ON CONFLICT DO NOTHING, never blind INSERT). */
  run: (db: unknown) => Promise<void>;
};

const registered: Seeder[] = [];

export function registerSeeder(seeder: Seeder): void {
  registered.push(seeder);
}

export function listSeeders(): readonly Seeder[] {
  return registered;
}

export async function runSeeders(): Promise<string[]> {
  const ran: string[] = [];
  for (const seeder of registered) {
    await seeder.run(undefined);
    ran.push(seeder.name);
  }
  return ran;
}

async function main(): Promise<void> {
  loadDotenvIntoProcessEnv();
  loadEnv(); // fail fast with the standard env error if configuration is missing
  const seeders = listSeeders();
  if (seeders.length === 0) {
    process.stdout.write('[db:seed] no seeders registered yet — added by later prompts\n');
    return;
  }
  const ran = await runSeeders();
  process.stdout.write(`[db:seed] ran: ${ran.join(', ')}\n`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`[db:seed] failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
