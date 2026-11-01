import { createDb } from '../../db/drizzle.client.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadEnv } from '../../config/env.js';
import { flattenMessages } from '../../modules/i18n/i18n.bundle.js';
import { languages, translations } from '../../db/schema/i18n.js';
import { registerSeeder } from './registry.js';

/**
 * i18n seeders (B1.12) — both are `always`-mode by contract (idempotent,
 * run on every `db:seed`):
 *  - i18n-languages: ensures fa/en rows exist; never overwrites admin edits
 *  - i18n-messages: inserts seed keys ONLY when (locale, key) is absent, so
 *    an admin-edited translation survives every reseed
 */

const SEED_DIR = path.resolve(__dirname, '..', '..', 'modules', 'i18n', 'seed');

export function loadSeedMessages(locale: 'fa' | 'en'): Record<string, string> {
  const file = path.join(SEED_DIR, `${locale}.json`);
  return flattenMessages(JSON.parse(readFileSync(file, 'utf8')));
}

export async function seedI18nLanguages(
  databaseUrl: string,
  log: (message: string) => void,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = createDb(pool);
    const rows = [
      {
        code: 'fa',
        nameNative: 'فارسی',
        nameEn: 'Persian',
        dir: 'rtl' as const,
        isDefault: true,
        isActive: true,
        sortOrder: 1,
      },
      {
        code: 'en',
        nameNative: 'English',
        nameEn: 'English',
        dir: 'ltr' as const,
        isDefault: false,
        isActive: true,
        sortOrder: 2,
      },
    ];
    for (const row of rows) {
      // ON CONFLICT DO NOTHING: an admin may have renamed/deactivated rows.
      const inserted = await db.insert(languages).values(row).onConflictDoNothing().returning();
      log(
        inserted.length > 0
          ? `language ${row.code} created`
          : `language ${row.code} already present (untouched)`,
      );
    }
  } finally {
    await pool.end();
  }
}

export async function seedI18nMessages(
  databaseUrl: string,
  log: (message: string) => void,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = createDb(pool);
    for (const locale of ['fa', 'en'] as const) {
      const messages = loadSeedMessages(locale);
      const entries = Object.entries(messages).map(([key, value]) => ({ locale, key, value }));
      // Insert-if-absent: primary key (locale, key) makes this atomic and
      // idempotent; existing rows (including admin edits) are NEVER touched.
      const inserted = await db
        .insert(translations)
        .values(entries)
        .onConflictDoNothing()
        .returning({ key: translations.key });
      log(
        `${locale}: inserted ${inserted.length}, kept ${entries.length - inserted.length} existing`,
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
  name: 'i18n-languages',
  run: async () => {
    await seedI18nLanguages(seedDatabaseUrl(), (msg) =>
      process.stdout.write(`[db:seed] i18n-languages: ${msg}\n`),
    );
  },
});

registerSeeder({
  name: 'i18n-messages',
  run: async () => {
    await seedI18nMessages(seedDatabaseUrl(), (msg) =>
      process.stdout.write(`[db:seed] i18n-messages: ${msg}\n`),
    );
  },
});
