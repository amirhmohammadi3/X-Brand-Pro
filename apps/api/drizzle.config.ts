import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration. `db:generate` (drizzle-kit generate) needs no
 * live database — it diffs src/db/schema against drizzle/meta snapshots.
 * `url` is only used by drizzle-kit's own push/migrate commands, which this
 * repo does NOT use (we run migrations through src/db/migrate.ts). The
 * fallback keeps `db:generate` working without a .env file present.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/app',
  },
});
