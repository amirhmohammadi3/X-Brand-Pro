#!/usr/bin/env node
// CLI: run idempotent seeders.
// Usage: node dist/src/db/seed/run.js [--test]
// Seeder files register themselves via registerSeeder() from
// registry.ts (e.g. super-admin.ts, later B2.10). Every seeder must be
// idempotent: running it twice must not duplicate rows.

import { loadEnv } from '../../config/env.js';
import { loadDotenvIntoProcessEnv } from '../load-dotenv.js';
import { listSeeders, runSeeders } from './registry.js';

// Importing registers the seeders (side-effect modules).
import './super-admin.js';
import './i18n.seed.js';
import './theme.seed.js';
import './catalog.seed.js'; // B2.10: tehran geo, categories/amenities, demo businesses
import './notifications.seed.js'; // B5.3: the event catalog

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
