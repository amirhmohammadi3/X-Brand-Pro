# DATA MODEL

PostgreSQL with PostGIS, pg_trgm, unaccent. Schema files live in `apps/api/src/db/schema/<domain>.ts`; migrations in `apps/api/drizzle`. Every executing prompt that changes the schema appends or updates its tables here.

Block format (one per table):

```text
### <table_name>
- Module: <module>             - Prompt: <ID>
- Purpose: <one line>
- Columns of note: <name type constraint meaning>, one per line
- Indexes: <name: columns, type (btree/gist/gin/unique), reason>
- Constraints: <checks, foreign keys with on delete behavior>
- Retention: <soft delete, purge job, or keep forever>
```

## Extensions and conventions

- Extensions: postgis, pg_trgm, unaccent, pgcrypto. Created idempotently (`CREATE EXTENSION IF NOT EXISTS`) by two paths: `apps/api/src/db/migrate.ts` (`ensureExtensions`, runs before every migration apply, including the test database via `db:migrate:test`) and `infra/db/init` SQL in Docker dev environments. They are deliberately NOT drizzle-kit-managed migrations because drizzle-kit cannot snapshot extension DDL.
- Conventions are in AGENTS.md section 6 (uuid primary keys via `gen_random_uuid()` from pgcrypto, UTC timestamptz, money in Rials as bigint, jsonb localized text, geography(Point,4326)).

## Database tooling (B0.2)

- ORM: drizzle-orm 0.45.4 (`pg` 8.23.1 driver). Client: `apps/api/src/db/drizzle.client.ts` (`DrizzleClient`, DI token `DRIZZLE_POOL`; global `DrizzleModule`; pool ends on application shutdown).
- Schema barrel: `apps/api/src/db/schema/index.ts` — drizzle-kit reads only this tree.
- Config: `apps/api/drizzle.config.ts` (schema `./src/db/schema/index.ts`, out `./drizzle`).
- Commands: `pnpm db:generate` (drizzle-kit generate, no DB needed), `pnpm db:migrate` (build + CLI; env `DATABASE_URL`), `pnpm db:migrate:test` (env `TEST_DATABASE_URL`), `pnpm db:seed` (runs registered seeders; none yet).
- Migration journal: `apps/api/drizzle/meta/_journal.json` (initialized empty; drizzle-kit appends entries on `db:generate`).
- CLI `.env` support: `src/db/load-dotenv.ts` walks up from cwd to the repo root; process env always wins over file values.

## Tables

### settings

- Module: settings - Prompt: B1.1
- Purpose: runtime configuration an admin may change without a deploy; one row per registry key (overrides only — defaults live in settings.registry.ts)
- Columns of note:
  - key text PRIMARY KEY — dotted lowercase key (e.g. site.name, sms.driver)
  - value jsonb NOT NULL — plain JSON for normal settings; AES-256-GCM envelope string (v1.iv.tag.ct) for secrets
  - is_secret boolean NOT NULL default false — mirrors the registry definition
  - group text NOT NULL — settings group (general, localization, integrations, theme, flags)
  - description text NULL
  - updated_at timestamptz NOT NULL default now()
- Indexes: settings_group_idx: (group), btree — admin listing filter
- Constraints: primary key on key; no foreign keys
- Retention: rows live until an admin resets the key (DELETE removes the override)
