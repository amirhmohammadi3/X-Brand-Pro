/**
 * Super admin seeder (B1.3) — mode "once".
 *
 * Creates the bootstrap super_admin from SEED_SUPERADMIN_* env when no
 * super_admin exists. Idempotent: re-running with an existing super_admin
 * is a no-op. Refuses in production when the password is empty or equals
 * the .env.example value. The password must satisfy the shared
 * contracts passwordSchema (8+ chars, letter + digit).
 */
import { eq } from 'drizzle-orm';
import { passwordSchema, usernameSchema } from '@app/contracts';
import { loadEnv } from '../../config/env.js';
import { createDb, createPool } from '../drizzle.client.js';
import { users } from '../schema/users.js';
import { hashPassword } from '../../modules/auth/password.service.js';
import { registerSeeder } from './registry.js';

/** Must match the value documented in .env.example — refused in production. */
const EXAMPLE_SUPERADMIN_PASSWORD = 'ChangeMe_SuperAdmin1';

export async function seedSuperAdmin(
  databaseUrl: string,
  env: {
    isProduction: boolean;
    username?: string;
    password?: string;
    email?: string;
  },
  log: (msg: string) => void = () => {},
): Promise<'created' | 'exists' | 'skipped'> {
  const pool = createPool(databaseUrl);
  const db = createDb(pool);
  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'super_admin'));
    if (existing.length > 0) {
      log('super admin already exists — skipping');
      return 'exists';
    }

    if (!env.username || !env.password) {
      log('SEED_SUPERADMIN_USERNAME / SEED_SUPERADMIN_PASSWORD not set — skipping');
      return 'skipped';
    }
    if (env.isProduction && (env.password === '' || env.password === EXAMPLE_SUPERADMIN_PASSWORD)) {
      throw new Error(
        'Refusing to seed the super admin in production with the example/empty password — set a real SEED_SUPERADMIN_PASSWORD',
      );
    }
    const username = usernameSchema.parse(env.username);
    const password = passwordSchema.parse(env.password);
    const email = env.email ? env.email.trim().toLowerCase() : null;

    const passwordHash = await hashPassword(password);
    await db.insert(users).values({
      username,
      email,
      passwordHash,
      role: 'super_admin',
      displayName: null,
      locale: 'fa',
      // The bootstrap admin's email is operator-provided and trusted.
      emailVerifiedAt: email ? new Date() : null,
    });
    log(`super admin '${username}' created`);
    return 'created';
  } finally {
    await pool.end().catch(() => {});
  }
}

registerSeeder({
  name: 'super-admin',
  run: async () => {
    const env = loadEnv();
    const url = process.argv.includes('--test')
      ? env.TEST_DATABASE_URL
      : (process.env.DATABASE_URL ?? env.DATABASE_URL);
    await seedSuperAdmin(
      url,
      {
        isProduction: env.NODE_ENV === 'production',
        username: process.env.SEED_SUPERADMIN_USERNAME,
        password: process.env.SEED_SUPERADMIN_PASSWORD,
        email: process.env.SEED_SUPERADMIN_EMAIL,
      },
      (msg) => process.stdout.write(`[db:seed] super-admin: ${msg}\n`),
    );
  },
});
