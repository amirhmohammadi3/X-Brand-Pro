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

### theme_packs

- Module: theme - Prompt: B1.13
- Purpose: the three builtin theme packs (modern/warm/luxe) with admin-editable tokens; the shipped values live ONLY in `packages/contracts/src/theme/packs.ts` (docs/DESIGN.md section 1: tokens defined once).
- Columns of note: `id text pk` ('modern'|'warm'|'luxe'), `names jsonb` (localizedText map), `tokens jsonb` (full themeTokensSchema payload), `version int` (bumped on every token edit; part of the public version string), `is_builtin boolean`, `updated_by uuid` FK users ON DELETE SET NULL
- Indexes: primary key only
- Constraints: tokens validated against `themeTokensSchema` + `validatePackContrast` at the API boundary; re-seeding never overwrites edited tokens (insert-if-absent)
- Retention: keep forever

### users — B1.14 additions

- Module: users (admin API) - Prompt: B1.14
- New column: `banned_reason text` (3-500 chars, set by POST /:id/ban, cleared on unban/expire)
- New indexes: `users_username_trgm_idx` GIN on `lower(username) gin_trgm_ops`, `users_email_trgm_idx` GIN on `lower(email)`, `users_display_name_trgm_idx` GIN on `lower(display_name)` (admin q search); `users_status_idx` + `users_created_at_idx` btree (admin list filters/sort)
- Sorting note: admin list always appends `id` as the stable tiebreaker (AGENTS.md 6)

### cities

- Module: geo - Prompt: B2.1
- Purpose: the cities catalog; translatable names (`{ fa, en, … }`), PostGIS center point + optional bbox, per-city IANA timezone, activation flag, manual sort order. Public reads see active rows only; admin sees all + neighborhood/business counts.
- Columns of note: `id uuid pk default gen_random_uuid()`, `slug text unique`, `name jsonb` (localizedText; CHECK `name ? 'fa'`), `name_fa text` GENERATED ALWAYS AS (`name ->> 'fa'`) STORED (B3.1: derived Persian display name for trigram-backed auto-suggest; never NULL for a valid row because of the `name ? 'fa'` CHECK), `center geography(Point, 4326)` (GiST indexed), `bbox jsonb` nullable (`{ west, south, east, north }`), `timezone text default 'Asia/Tehran'`, `is_active boolean default false`, `sort_order int default 0`, `created_at`/`updated_at` timestamptz
- Indexes: `cities_center_idx` GiST on center; unique on slug; `cities_name_fa_trgm_idx` GIN trigram (`gin_trgm_ops`) on `name_fa` (B3.1: prefix/fuzzy city suggest)
- Constraints: `cities_name_has_fa` CHECK (`name ? 'fa'`); bbox east>west, north>south, center-in-bbox enforced at the API boundary (`createCityBodySchema`)
- Retention: keep forever (deactivate instead of delete when businesses exist)

### neighborhoods

- Module: geo - Prompt: B2.1
- Purpose: neighborhoods scoped to a city; same localized-name + PostGIS-center pattern; `(city_id, slug)` is unique so two cities may reuse a slug.
- Columns of note: `id uuid pk`, `city_id uuid` FK cities ON DELETE CASCADE, `slug text`, `name jsonb` (CHECK `name ? 'fa'`), `name_fa text` GENERATED ALWAYS AS (`name ->> 'fa'`) STORED (B3.1: trigram-backed neighborhood suggest), `center geography(Point, 4326)` (GiST indexed), `is_active boolean default true`, `sort_order int default 0`, `created_at`/`updated_at` timestamptz
- Indexes: `neighborhoods_center_idx` GiST on center; `neighborhoods_city_slug_unique` unique on (city_id, slug); `neighborhoods_name_fa_trgm_idx` GIN trigram (`gin_trgm_ops`) on `name_fa` (B3.1)
- Constraints: `neighborhoods_name_has_fa` CHECK (`name ? 'fa'`)
- Retention: cascade-deleted with the parent city

### categories

- Module: catalog - Prompt: B2.2
- Purpose: hierarchical business categories, two levels (a root has `parent_id = null`; a child points at its parent). The depth rule (a child may not have children) is enforced in the service, not by a DB constraint.
- Columns of note: `id uuid pk default gen_random_uuid()`, `parent_id uuid` self-FK `categories(id)` ON DELETE RESTRICT (nullable — null = root), `slug text unique` (globally unique), `name jsonb` (localizedText; CHECK `name ? 'fa'`), `name_fa text` GENERATED ALWAYS AS (`name ->> 'fa'`) STORED (B3.1: trigram-backed category suggest), `description jsonb` nullable (localized map, `fa` optional), `icon text not null default 'store'` (validated against `CATEGORY_ICONS` at the API boundary), `color text` (semantic accent `accent-1..8`, never raw hex), `kind text not null default 'none'` CHECK in (`menu`,`services`,`none`), `supports_reservation boolean not null default false`, `is_active boolean not null default true`, `sort_order int not null default 0`, `created_at`/`updated_at` timestamptz
- Indexes: `categories_parent_sort_idx` btree on (parent_id, sort_order); unique on slug; `categories_name_fa_trgm_idx` GIN trigram (`gin_trgm_ops`) on `name_fa` (B3.1)
- Constraints: `categories_name_has_fa` CHECK (`name ? 'fa'`); `categories_kind_enum` CHECK (`kind in ('menu','services','none')`); self-FK `categories_parent_id_categories_id_fk` ON DELETE RESTRICT (a parent with children cannot be deleted at the DB level either)
- Retention: keep forever (deactivate instead of delete when children/businesses exist)

### amenities

- Module: catalog - Prompt: B2.3
- Purpose: features such as Wi-Fi, parking, outdoor seating — flat catalog (no hierarchy) with translations, an icon and a group. Linked to categories through `category_amenities`.
- Columns of note: `id uuid pk default gen_random_uuid()`, `slug text unique`, `name jsonb` (localizedText; CHECK `name ? 'fa'`), `name_fa text` GENERATED ALWAYS AS (`name ->> 'fa'`) STORED (B3.1: trigram-backed amenity suggest), `icon text not null default 'wifi'` (validated against `AMENITY_ICONS` at the API boundary), `group text not null default 'general'` CHECK in (`general`,`food`,`payment`,`accessibility`,`family`,`comfort`), `is_active boolean not null default true`, `sort_order int not null default 0`, `created_at`/`updated_at` timestamptz
- Indexes: unique on slug; `amenities_name_fa_trgm_idx` GIN trigram (`gin_trgm_ops`) on `name_fa` (B3.1)
- Constraints: `amenities_name_has_fa` CHECK (`name ? 'fa'`); `amenities_group_enum` CHECK (`group in (...)`)
- Retention: keep forever (deactivate instead of delete when businesses use it)

### category_amenities

- Module: catalog - Prompt: B2.3
- Purpose: many-to-many mapping between categories and amenities. A category inherits its parent's amenities in the public endpoint (computed in the service, de-duplicated with the child mapping winning).
- Columns of note: `category_id uuid` FK categories ON DELETE CASCADE, `amenity_id uuid` FK amenities ON DELETE CASCADE, `sort_order int not null default 0` (orders amenities within a category), `created_at` timestamptz
- Indexes: composite PRIMARY KEY (category_id, amenity_id); `category_amenities_category_sort_idx` btree on (category_id, sort_order)
- Retention: cascade-deleted with either parent

### businesses

- Module: business - Prompt: B2.4
- Purpose: the core catalog entity — a real-world named place (cafe, clinic, shop) located by a PostGIS point, owned by a user, categorised, amenity-tagged and lifecycle-managed through a status state machine (draft→pending→active|rejected→…; see `BusinessDomainService.canTransition`). `name` is a SINGLE string in the owner's own spelling (any script); `nameAlt` carries the second script — businesses are real-world named entities, not translatable copy.
- Columns of note: `id uuid pk default gen_random_uuid()`, `slug text unique` (globally unique, includes soft-deleted rows), `name text not null`, `name_normalized text` nullable (B3.1: `normalizePersianText(name)` written by the service — Arabic ي→ی/ك→ک, tatweel/diacritics stripped, whitespace+ZWNJ unified; powers the trigram index and is the source the tsvector is built from so search tokens are pre-normalized once at write time), `name_alt text` nullable, `description text` nullable (max 5000 enforced in contracts), `city_id uuid` FK cities ON DELETE RESTRICT, `neighborhood_id uuid` FK neighborhoods ON DELETE SET NULL, `primary_category_id uuid` FK categories ON DELETE RESTRICT, `address text not null`, `location geography(Point, 4326)` not null (GiST indexed), `price_level smallint` nullable CHECK 1..4, `phone`/`whatsapp`/`telegram`/`instagram`/`website`/`email text` nullable (normalised at the edge: phones→E.164, handles extracted from URLs, email lowercased), `status business_status` not null default `pending` (pgEnum: draft/pending/active/suspended/rejected/closed), `owner_id`/`created_by uuid` FK users ON DELETE SET NULL, `is_claimed`/`is_featured`/`is_demo boolean default false`, `avg_rating numeric(3,2) not null default 0` (CHECK 0..5), `review_count int not null default 0` (CHECK ≥0), `cover_media_id uuid` FK media_files ON DELETE SET NULL, `tags text[] not null default '{}'`, `source text not null default 'manual'` CHECK in (manual, import), `rejection_reason text` nullable, `published_at timestamptz` nullable, `search_vector tsvector` GENERATED ALWAYS AS (`setweight(to_tsvector('simple', coalesce(name_normalized, name)), 'A') || setweight(to_tsvector('simple', coalesce(name_alt, '')), 'B') || setweight(to_tsvector('simple', coalesce(description, '')), 'C') || to_tsvector('simple', coalesce(address, ''))`) STORED (B3.1: weighted full-text vector; weight A=name so name hits rank highest, B=name_alt, C=description, address unweighted), `created_at`/`updated_at`/`deleted_at timestamptz`
- Indexes: `businesses_location_idx` GiST on location; `businesses_city_status_cat_idx` btree (city_id, status, primary_category_id); `businesses_neighborhood_idx` btree (neighborhood_id); `businesses_owner_idx` btree (owner_id); `businesses_status_created_idx` btree (status, created_at DESC); unique on slug; `businesses_active_city_rating_idx` UNIQUE btree (city_id, avg_rating DESC) WHERE `status='active' and deleted_at is null` (the public per-city rating leaderboard); `businesses_search_vector_idx` GIN on `search_vector` (B3.1: powers `WHERE search_vector @@ to_tsquery('simple', …)`); `businesses_name_trgm_idx` GIN trigram (`gin_trgm_ops`) on `name_normalized` (B3.1: ILIKE `%foo%` and `similarity()`/`word_similarity()` for fuzzy/prefix matching)
- Constraints: `businesses_avg_rating_range` CHECK (avg_rating between 0 and 5); `businesses_review_count_nonneg` CHECK (review_count ≥ 0); `businesses_active_requires_published` CHECK (status <> 'active' or published_at is not null — an active row must have a publish timestamp); `businesses_source_enum` CHECK (source in (manual, import)); FKs city/primary_category RESTRICT, neighborhood/owner/created_by/cover SET NULL
- Retention: soft delete (`deleted_at`) — kept for audit + SEO redirect; excluded from public lists, counters and the active-city-rating index

### business_categories

- Module: business - Prompt: B2.4
- Purpose: many-to-many between businesses and categories, with a primary flag. The repository guarantees exactly one primary category per business; the partial unique index makes a second `is_primary=true` row for the same business impossible at the DB level.
- Columns of note: `business_id uuid` FK businesses ON DELETE CASCADE, `category_id uuid` FK categories ON DELETE CASCADE, `is_primary boolean not null default false`, `created_at timestamptz`
- Indexes: composite PRIMARY KEY (business_id, category_id); `business_categories_one_primary` UNIQUE btree (business_id) WHERE `is_primary` (at most one primary per business); `business_categories_category_idx` btree (category_id) (powers `countByCategory`)
- Constraints: composite PK; both FKs ON DELETE CASCADE
- Retention: cascade-deleted with either parent

### business_amenities

- Module: business - Prompt: B2.4
- Purpose: many-to-many between businesses and amenities. Powers the business detail's amenities list and the `AmenityUsageCounter` delete guard (B2.3 now refuses deleting an amenity used by a business).
- Columns of note: `business_id uuid` FK businesses ON DELETE CASCADE, `amenity_id uuid` FK amenities ON DELETE CASCADE, `created_at timestamptz`
- Indexes: composite PRIMARY KEY (business_id, amenity_id); `business_amenities_amenity_idx` btree (amenity_id) (powers `countByAmenity`)
- Constraints: composite PK; both FKs ON DELETE CASCADE
- Retention: cascade-deleted with either parent

### business_hours

- Module: business - Prompt: B2.5
- Purpose: weekly opening hours — one row per interval per weekday. `all_day` rows store the `{ weekday, allDay: true }` shortcut as a single row (`open_time = 00:00`, `close_time = 24:00`); normal intervals store `open_time`/`close_time` with `crosses_midnight` flagging `close < open` (the interval spills into the next day's early hours). `close = 24:00` is end-of-day and does NOT cross midnight.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses ON DELETE CASCADE, `weekday smallint not null` (CHECK 1..7, ISO: 1 Mon .. 7 Sun), `open_time time(0) not null`, `close_time time(0) not null` (PostgreSQL `time` accepts `24:00:00` = midnight at end of day; the repository maps `HH:mm` ↔ `HH:mm:ss`), `crosses_midnight boolean not null default false`, `all_day boolean not null default false`, `sort_order smallint not null default 0`, `created_at`/`updated_at timestamptz`
- Indexes: `business_hours_biz_weekday_idx` btree (business_id, weekday)
- Constraints: `business_hours_weekday_range` CHECK (weekday between 1 and 7); FK business_id CASCADE. Overlap, weekday-uniqueness and the allDay/intervals exclusivity are validated in `weeklyHoursSchema` (contracts) at the edge, not at the DB.
- Retention: cascade-deleted with the business; replaced wholesale by `HoursRepository.replaceWeekly` (delete + insert in one transaction)

### business_special_days

- Module: business - Prompt: B2.5
- Purpose: per-date overrides of the weekly schedule. `closed = true` cancels the day (and cancels the previous day's midnight-crossing tail — see `computeOpenStatus`); otherwise `intervals` (a JSONB array of `{ open, close }`) replaces the weekly schedule for that date. `unique (business_id, date)` guarantees one override per business per date.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses ON DELETE CASCADE, `date date not null` (stored/returned as `YYYY-MM-DD`), `closed boolean not null`, `intervals jsonb` nullable (array of `{ open, close }` validated with `intervalSchema` on read), `note text` nullable (≤200), `created_at`/`updated_at timestamptz`
- Indexes: `business_special_days_biz_date_unq` UNIQUE btree (business_id, date); `business_special_days_biz_date_idx` btree (business_id, date)
- Constraints: unique (business_id, date); FK business_id CASCADE. The closed+intervals conflict is validated in `upsertSpecialDayBodySchema` at the edge.
- Retention: cascade-deleted with the business; upserted via `onConflictDoUpdate` on (business_id, date)

### business_photos

- Module: business - Prompt: B2.7
- Purpose: the ordered photo gallery of a business. Every row points at an already-uploaded `media_files` row (kind `business_photo`) that the attach flow marks attached; the cover is NOT a flag here — `businesses.cover_media_id` points at the media of one of these rows, so cover and gallery can never disagree.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses ON DELETE CASCADE, `media_id uuid` FK media_files ON DELETE CASCADE, `sort_order smallint not null` (0-based; the owner sets it via the full-permutation reorder), `created_at timestamptz`
- Indexes: `business_photos_media_unq` UNIQUE btree (media_id); `business_photos_biz_sort_idx` btree (business_id, sort_order)
- Constraints: media_id UNIQUE (one media row hangs on at most one gallery); both FKs CASCADE. The attach-time rules (kind, ownership, cap 10, not-already-attached) are validated in `PhotosService` at the edge.
- Retention: cascade-deleted with the business; the media row is soft-deleted when a photo is removed (physical files removed by the `media` worker queue); an inserted-but-never-attached media row is swept by the hourly orphan cleanup and its gallery row cascades away.

### business_menu_sections

- Module: business - Prompt: B2.8
- Purpose: named sections of a business menu / services list ("غذاهای اصلی", "خدمات"). Ordered manually; the whole menu is replaced atomically (B2.5-style full replace), so array order in the payload becomes `sort_order`.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses ON DELETE CASCADE, `name text not null` (≤120 validated at the edge), `sort_order smallint not null` (0-based), `created_at`/`updated_at timestamptz`
- Indexes: `business_menu_sections_biz_sort_idx` btree (business_id, sort_order)
- Constraints: FK business_id CASCADE. Name length, section cap (20) and item cap (50/section) are validated in `replaceMenuBodySchema` at the edge.
- Retention: cascade-deleted with the business; recreated on every full-menu replace.

### business_menu_items

- Module: business - Prompt: B2.8
- Purpose: items of a menu section (a dish, a service) with an optional price in RIALS (integer, no float money — DECISIONS B2.8) and an optional photo (`media_files` kind `menu_photo`). `business_id` is denormalised from the section so the replace flow wipes one business's menu with scoped deletes and "does this item belong to this business" is a single indexed check.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses CASCADE, `section_id uuid` FK business_menu_sections CASCADE, `name text not null` (≤200), `description text` nullable (≤1000), `price bigint` nullable (rials, CHECK ≥ 0, ≤ 1e12 at the edge; null = not priced), `photo_media_id uuid` FK media_files ON DELETE SET NULL (the item survives a media hard-delete with its photo nulled), `is_available boolean not null` default true, `sort_order smallint not null`, `created_at`/`updated_at timestamptz`
- Indexes: `business_menu_items_section_sort_idx` btree (section_id, sort_order); `business_menu_items_biz_idx` btree (business_id)
- Constraints: `business_menu_items_price_nonneg` CHECK (price ≥ 0); both cascade FKs; photo SET NULL. Kind/ownership/attachment rules of the photo are validated in `MenuService` at the edge.
- Retention: cascade-deleted with the business or its section; rows are RECREATED on every full-menu replace (no stable client-side identity — nothing references item ids yet; reviews reference the business, B4.x).

### business_claims

- Module: business - Prompt: B2.9
- Purpose: ownership claims on unclaimed businesses. A user files evidence (text + optional uploaded `claim_document` media); an admin approves (the claimant becomes the owner — `owner_id` + `is_claimed` in ONE transaction with the claim closing) or rejects (a required note). The claimant may cancel their own pending claim.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses CASCADE, `claimant_user_id uuid` FK users CASCADE, `status business_claim_status enum` not null default `pending` (`pending|approved|rejected|cancelled`), `evidence text not null` (20..2000 at the edge), `document_media_id uuid` FK media_files ON DELETE SET NULL (a media hard-delete keeps the claim's audit trail), `reviewed_by uuid` FK users SET NULL (an admin account removal must not erase the decision), `admin_note text` nullable (≤500; required on reject), `decided_at timestamptz` nullable, `created_at`/`updated_at timestamptz`
- Indexes: `business_claims_one_pending` UNIQUE btree (business_id) WHERE status = 'pending'; `business_claims_claimant_idx` btree (claimant_user_id, created_at desc); `business_claims_status_created_idx` btree (status, created_at desc)
- Constraints: at most one PENDING claim per business (partial unique index); the approve transaction re-checks `owner_id IS NULL` so a business claimed in the meantime cannot double-own.
- Retention: cascade-deleted with the business; the claimant user's deletion cascades their claims (evidence is personal data); decided claims are kept for audit.

### search_queries

- Module: search - Prompt: B3.5
- Purpose: the GLOBAL popularity counter behind `GET /search/popular` — one row per normalized query text (+ optional city scope), a `hits` counter bumped on every text search (anonymous included). NO user identity is ever written here (privacy: aggregate text only).
- Columns of note: `id uuid pk`, `normalized_text text not null` (canonical form — `normalizePersianText` + `normalizeDigits`, DECISIONS B3.1/3.2), `text text not null` (first-seen display spelling), `city_id uuid` FK cities CASCADE nullable (the search's `cityId` facet; null = no-city variant), `hits integer not null` default 1, `result_count integer not null` default 0 (the last search's total), `last_searched_at timestamptz not null`
- Indexes/constraints: `search_queries_normalized_city_uniq` UNIQUE NULLS NOT DISTINCT (normalized_text, city_id) — Postgres 16; without NULLS NOT DISTINCT two NULL city_ids would be distinct rows and the `ON CONFLICT` upsert would never fire for the anonymous variant; `search_queries_popular_idx` btree (hits DESC, last_searched_at DESC) drives the popular list; `search_queries_city_idx` btree (city_id)
- Retention: grows with distinct query texts only (deduped by the canonical form); the admin does not edit it; a city deletion cascades its scoped counters (the no-city rows survive).

### search_history

- Module: search - Prompt: B3.5
- Purpose: the PER-USER recent-search list behind `GET /search/history` — upserted automatically by `GET /search` when a valid access token rides along (re-searching the same canonical text bumps `searched_at` and refreshes the display `text`), pruned to the newest `HISTORY_LIMIT` (20) rows per user on every record. Owned by the user: clear-all and remove-one endpoints delete rows.
- Columns of note: `id uuid pk`, `user_id uuid` FK users CASCADE, `normalized_text text not null` (canonical form), `text text not null` (latest display spelling via the upsert), `city_id uuid` FK cities ON DELETE SET NULL nullable, `searched_at timestamptz not null`
- Indexes/constraints: `search_history_user_query_uniq` UNIQUE NULLS NOT DISTINCT (user_id, normalized_text, city_id) — makes the upsert idempotent (no duplicate rows for the same query); `search_history_user_recent_idx` btree (user_id, searched_at DESC) drives the newest-first list
- Retention: capped at 20 rows/user by the service prune; user deletion cascades (personal data); city deletion nulls the scope but keeps the entry.

### reviews

- Module: reviews — Prompt: B4.1
- Purpose: a user's rating (1..5) + text (+ optional photo) of an ACTIVE business. ONE review per user per business (re-reviewing means editing the existing row — a second create is a 409). Rows are created `approved` (visible + counted immediately); `pending`/`rejected` are reserved for the moderation prompts (B4.4 queue, B4.5 spam filter) to flip rows into without a migration. The business aggregate (`businesses.avg_rating`/`review_count`) is recomputed ASYNCHRONOUSLY from the approved rows by the `reviews` queue's `recompute-rating` job (jobId = `recompute:<businessId>` collapses bursts; the full recompute-from-source design makes collapsing and reordering drift-free) — never inline in the request path.
- Columns of note: `id uuid pk`, `business_id uuid` FK businesses CASCADE, `user_id uuid` FK users CASCADE, `rating smallint not null` CHECK 1..5, `body text not null` CHECK char_length 10..2000, `status review_status enum` not null default `approved` (`approved|pending|rejected`), `photo_media_id uuid` FK media_files ON DELETE SET NULL (one photo per review, uploaded via POST /media/upload kind `review_photo`; a media hard-delete keeps the review with the photo nulled — the claims-document scheme), `edited_at timestamptz` nullable (stamped on author edit), `created_at`/`updated_at timestamptz`
- Indexes/constraints: `reviews_one_per_business` UNIQUE (business_id, user_id); `reviews_business_list_idx` btree (business_id, status, created_at DESC, id) drives the public business page list; `reviews_user_idx` btree (user_id, created_at DESC) drives GET /reviews/me; `reviews_status_created_idx` btree (status, created_at ASC) is the B4.4 moderation-queue triage index; CHECKs `reviews_rating_range` (1..5) and `reviews_body_len` (10..2000)
- Retention: hard delete (no soft delete) — author deletion or `reviews.manage` takedown removes the row; the aggregate job then resets the business counters. Business deletion cascades; user deletion cascades (GDPR-style personal data).

### review_votes

- Module: reviews — Prompt: B4.2
- Purpose: helpful (1) / unhelpful (-1) votes on reviews — the social-proof signal behind `helpfulCount`/`unhelpfulCount` in the review contract. ONE vote per user per review: the unique index makes the write an UPSERT (same value re-vote = idempotent no-op, opposite value switches in place) and `DELETE /reviews/:id/vote` withdraws it. Votes apply to APPROVED reviews only and self-votes are rejected in the service (not the schema).
- Columns of note: `id uuid pk`, `review_id uuid` FK reviews CASCADE, `user_id uuid` FK users CASCADE, `value smallint not null` CHECK `value IN (1, -1)`, `created_at`/`updated_at timestamptz` (updated_at stamped when a vote switches).
- Indexes/constraints: `review_votes_one_per_user` UNIQUE (review_id, user_id) — the upsert target AND the per-review count scan (review_id is the leading column; the list queries count votes in correlated subselects off this index); `review_votes_user_idx` btree (user_id, created_at DESC) for the voter's own votes; CHECK `review_votes_value`.
- Retention: cascade-only — a deleted review or user takes the votes with it. Votes are NOT denormalised onto `reviews` anywhere; every read derives the counts fresh, so switches and moderation takedowns can never drift the displayed score. Votes are deliberately not audit-logged (high-volume, no content — the `review.voted`/`review.vote.removed` events + rate limit carry the abuse signal for B4.5/B4.7).
