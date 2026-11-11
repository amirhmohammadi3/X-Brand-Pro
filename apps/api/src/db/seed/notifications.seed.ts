import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { NOTIFICATION_EVENT_DEFAULTS, NOTIFICATION_EVENT_KEYS } from '@app/contracts';
import { notificationEvents } from '../../db/schema/notifications.js';
import { loadEnv } from '../../config/env.js';
import { registerSeeder } from './registry.js';

/**
 * notification-events seeder (B5.3) — `always`-mode but INSERT-IF-ABSENT:
 * one catalog row per contracts key lands once with the code defaults;
 * admin-edited defaults are never overwritten by a reseed (deactivate or
 * edit through the admin surface — B6.x). The service falls back to the
 * code defaults for a missing row, so seeding is an optimization, not a
 * correctness gate.
 */
export async function seedNotificationEvents(
  databaseUrl: string,
  log: (message: string) => void,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const defaults = NOTIFICATION_EVENT_DEFAULTS[key];
      const inserted = await db
        .insert(notificationEvents)
        .values({
          key,
          inApp: defaults.inApp,
          email: defaults.email,
          sms: defaults.sms,
          push: defaults.push,
          isActive: true,
        })
        .onConflictDoNothing({ target: notificationEvents.key })
        .returning({ id: notificationEvents.id });
      log(
        inserted.length > 0 ? `event ${key} created` : `event ${key} already present (untouched)`,
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
  name: 'notification-events',
  run: async () => {
    await seedNotificationEvents(seedDatabaseUrl(), (msg) =>
      process.stdout.write(`[db:seed] notification-events: ${msg}\n`),
    );
  },
});
