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

### users

- Module: users - Prompt: B1.2
- Purpose: user accounts for all roles; auth prompts (B1.3/B1.7/B1.8) fill credentials
- Columns of note:
  - id uuid PRIMARY KEY default gen_random_uuid()
  - username text NOT NULL — normalized (trim+lowercase) by usernameSchema; unique in practice (checked in service until a unique index lands with B1.3 seeding)
  - email text NULL — nullable until an email login method connects it
  - phone text NULL — E.164 +989… format (AGENTS.md 8)
  - password_hash text NULL — argon2id (B1.3); NULL for OTP/Google-only accounts
  - role user_role enum NOT NULL default 'user' — user|owner|moderator|admin|super_admin
  - status user_status enum NOT NULL default 'active' — active|blocked
  - display_name text NULL
  - created_at / updated_at timestamptz NOT NULL
  - last_seen_at timestamptz NULL — touched on authenticated activity (B1.3)
- Indexes: users_username_idx, users_email_idx, users_phone_idx (btree, login lookups), users_role_idx (admin filters)
- Constraints: unique username/email/phone enforced at service level in B1.2 (partial unique indexes arrive with B1.3 migrations when all writers exist)
- Retention: no soft delete in B1.2; account deletion is a B1.10 deliverable

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

### sessions

- Module: auth - Prompt: B1.3
- Purpose: server-side sessions; one row per issued refresh token. Rotation chains share `family_id`; reuse detection burns the family
- Columns of note:
  - id uuid PRIMARY KEY default gen_random_uuid()
  - user_id uuid NOT NULL → users.id ON DELETE CASCADE
  - family_id uuid NOT NULL — rotation family (set on create, kept across rotations)
  - refresh_hash text NOT NULL UNIQUE — SHA-256 hex of the opaque refresh token; the raw token is NEVER stored or logged
  - user_agent text NULL, ip inet NULL
  - created_at / last_used_at timestamptz NOT NULL
  - expires_at timestamptz NOT NULL — refresh TTL (REFRESH_TTL_DAYS, default 30d)
  - revoked_at timestamptz NULL, revoked_reason text NULL — logout | logout_all | reuse_detected | rotated(by replaced_by) | banned_user | revoked_by_user
  - replaced_by uuid NULL — id of the successor row; a NON-NULL value means the token was already consumed (presenting it again = reuse)
- Indexes: sessions_user_revoked_idx (user_id, revoked_at) btree — session listing + revoke-all; sessions_family_idx (family_id) btree — family burn
- Constraints: unique refresh_hash; FK user_id → users on delete cascade
- Retention: revoked rows kept for audit (purge policy is a later prompt)

### users (B1.3 additions)

- Module: auth - Prompt: B1.3
- New columns (migration `0002_plain_jack_flag`):
  - locale text NULL — preferred UI locale (localeCodeSchema shape); null = server default
  - email_verified_at / phone_verified_at timestamptz NULL — register stores email/phone UNVERIFIED; B1.7 flips the stamps
  - banned_until timestamptz NULL — temporary ban window; login and the guard reject while it is in the future
  - last_login_at timestamptz NULL — stamped on successful password login
- Uniqueness: username/email/phone uniqueness is still enforced in the service (same behavior as B1.2; partial unique indexes remain a follow-up)

### otp_codes

- Module: otp - Prompt: B1.4
- Purpose: generic one-time-code store for SMS/email login, verification and password reset (B1.7 consumes it)
- Columns of note:
  - id uuid PRIMARY KEY default gen_random_uuid() — part of the HMAC input (`<id>:<code>`)
  - purpose otp_purpose enum NOT NULL — login | verify_email | verify_phone | reset_password | change_email | change_phone
  - channel otp_channel enum NOT NULL — sms | email
  - target text NOT NULL — normalized E.164 phone or lowercase email
  - code_hash text NOT NULL — HMAC-SHA256 hex of `<id>:<code>` keyed by OTP_HMAC_SECRET; the PLAIN code is never stored
  - expires_at timestamptz NOT NULL — otp.ttlSec (default 120 s) from issue
  - attempts integer NOT NULL default 0 — incremented atomically on every verify try
  - max_attempts integer NOT NULL — otp.maxAttempts (default 5) snapshot at issue
  - consumed_at timestamptz NULL — success OR invalidation by a newer issue
  - created_at timestamptz NOT NULL, ip inet NULL, user_id uuid NULL → users.id ON DELETE SET NULL
- Indexes: otp_target_purpose_created_idx (target, purpose, created_at DESC) btree — latest-unconsumed lookup; otp_expires_at_idx btree — maintenance cleanup
- Constraints: FK user_id → users on delete set null
- Retention: maintenance queue job `otp:cleanup` (every 10 min, worker process) deletes rows expired more than 1 day ago

### oauth_accounts

- Module: apps/api/src/modules/auth (oauth) - Prompt: B1.8
- Purpose: linked external identities (Google B1.8); one row per (provider, provider user id).
- Columns of note:
  - `user_id uuid NOT NULL` → users.id ON DELETE CASCADE.
  - `provider text NOT NULL` — `'google'` for B1.8.
  - `provider_user_id text NOT NULL` — Google's stable `sub` claim (never the email).
  - `email text NULL` — reported email at link time, display/admin use only.
  - `created_at timestamptz NOT NULL DEFAULT now()`.
- Indexes: `oauth_accounts_provider_uid_key` UNIQUE (provider, provider_user_id) — login lookup; `oauth_accounts_user_id_idx` btree — list/unlink and last-method checks.
- Constraints: FK to users with cascade delete.
- Retention: deleted on unlink or user deletion (hard rows, no soft delete).

### media_files

- Module: media - Prompt: B1.9
- Purpose: every stored user file. Rows start unattached right after upload; the owning prompt's flow calls markAttached when the file is referenced by an entity. Orphans (unattached for > 24 h) are deleted hourly, files and rows.
- Columns of note:
  - id uuid PRIMARY KEY default gen_random_uuid()
  - owner_user_id uuid NULL → users.id ON DELETE SET NULL
  - kind media_kind enum NOT NULL — avatar | business_photo | review_photo | menu_photo | claim_document | message_attachment | verification_receipt
  - key text NOT NULL UNIQUE — storage driver address `<kind>/<yyyy>/<mm>/<uuid>.webp` (images; `.pdf` for documents); also the public url path after MEDIA_PUBLIC_BASE
  - thumb_key text NULL — 400 px WebP thumbnail key (null for raw documents)
  - mime text NOT NULL — STORED (post-processing) mime: always image/webp for images; application/pdf for untouched documents
  - size_bytes integer NOT NULL — bytes of the stored file
  - width/height integer NULL — processed (post-orientation) pixel size, null for documents
  - attached_at timestamptz NULL — set idempotently by markAttached(mediaId, ownerId)
  - created_at timestamptz NOT NULL, deleted_at timestamptz NULL (SOFT delete before queued file removal)
- Indexes: media_files_owner_created_idx (owner_user_id, created_at) btree; media_files_unattached_idx (attached_at) btree WHERE attached_at IS NULL — the hourly orphan scan
- Constraints: FK owner_user_id → users on delete set null
- Lifecycle jobs (worker process): `media` queue — `delete` jobs remove stored files of soft-deleted rows; repeatable `media:cleanup-orphans` (every hour) deletes rows unattached for more than 24 h together with their files

### users (B1.9 additions)

- Columns of note:
  - avatar_media_id uuid NULL → media_files.id ON DELETE SET NULL — deferred FK added in migration 0005 (alongside media_files) so B1.10 can wire the profile avatar without another migration; null until a profile sets it

### audit_logs

- Module: audit (B1.11)
- Purpose: append-only security trail — auth events, settings changes; later prompts log their own sensitive actions via `AuditService.log`.
- Columns of note:
  - `actor_user_id uuid null fk users on delete set null` — null for anonymous/session-scoped events
  - `actor_role text null` — snapshot of the actor role at write time
  - `action text not null` — dotted lowercase, e.g. `auth.login`, `settings.update`
  - `entity_type/entity_id text null` — what the action touched
  - `before/after jsonb null` — REDACTED payloads (sensitive keys, depth ≤ 6, strings ≤ 2000 chars)
  - `ip text null`, `user_agent text null`, `request_id text null`
- Indexes: `(created_at desc, id desc)` keyset paging; `(actor_user_id, created_at desc)`; `(action, created_at desc)`; `(entity_type, entity_id)`
- Retention: keep 2 years, then purge (purge job lands with the retention prompts)

### languages

- Module: i18n - Prompt: B1.12
- Purpose: UI languages available on the platform; the default language is the bundle-fallback source.
- Columns of note: `code text pk` (`fa`, `en`, `ar`…), `name_native text`, `name_en text`, `dir text` CHECK in ('rtl','ltr'), `is_default boolean`, `is_active boolean` (new languages start inactive), `sort_order int`
- Indexes: `languages_single_default_idx: (is_default) UNIQUE WHERE is_default (partial)` — at most one default
- Constraints: `languages_dir_check`; protected rows enforced server-side (`fa` never deactivated/deleted, default never deactivated)
- Retention: keep forever

### translations

- Module: i18n - Prompt: B1.12
- Purpose: flat dot-key message strings per locale (seeded from `apps/api/src/modules/i18n/seed/*.json`, admin-editable).
- Columns of note: `locale text` FK languages(code) ON DELETE CASCADE, `key text` (dot-separated, ≥2 segments — `i18nKeySchema`), `value text` (no HTML, control chars stripped, ≤5000 chars at the API boundary), `updated_by uuid` FK users ON DELETE SET NULL (null = seeder-written)
- Indexes: `translations_locale_updated_idx: (locale, updated_at) btree`
- Constraints: PRIMARY KEY (locale, key); values never contain HTML (enforced in the admin/import endpoints, B1.12)
- Retention: keep forever; cascades on language delete
