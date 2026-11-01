import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { defaultThemePacks } from '@app/contracts';
import { themePacks } from '../../db/schema/theme.js';
import { loadEnv } from '../../config/env.js';
import { registerSeeder } from './registry.js';

/**
 * theme-packs seeder (B1.13) — `always`-mode but INSERT-IF-ABSENT: the three
 * builtin packs land once; admin-edited tokens are never overwritten by a
 * reseed. `resetToDefault` (service) restores the shipped values explicitly.
 */
export async function seedThemePacks(
  databaseUrl: string,
  log: (message: string) => void,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });
    for (const pack of defaultThemePacks) {
      const inserted = await db
        .insert(themePacks)
        .values({
          id: pack.id,
          names: pack.names,
          tokens: pack.tokens,
          version: pack.version,
          isBuiltin: true,
        })
        .onConflictDoNothing({ target: themePacks.id })
        .returning({ id: themePacks.id });
      log(
        inserted.length > 0
          ? `pack ${pack.id} created`
          : `pack ${pack.id} already present (untouched)`,
      );
    }
  } finally {
    await pool.end();
  }
}

function seedDatabaseUrl(): string {
  const env = loadEnv();
  return process.argv.includes('--test')
    ? env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL ?? env.DATABASE_URL);
}

registerSeeder({
  name: 'theme-packs',
  run: async () => {
    await seedThemePacks(seedDatabaseUrl(), (msg) =>
      process.stdout.write(`[db:seed] theme-packs: ${msg}\n`),
    );
  },
});
