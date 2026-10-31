# AGENTS.md — Project rules (read this first in EVERY session)

You may rename this file to whatever your tool reads (CLAUDE.md, .cursorrules, GEMINI.md, README-AI.md). Keep the content identical.

## 1. Project summary

A local-business discovery and review platform for Iran (Persian, RTL-first, multi-language and multi-city). Real product, built only with free/open-source services, deployable on an Iranian host (Runflare or a VPS) without VPN, without CDN and without any external runtime dependency.

Roles: guest, user, owner (business owner), moderator, admin, super_admin.

Feature areas (all in scope, nothing is "later"): multi-method authentication (username/password, SMS OTP, email OTP, Google OAuth), cities and categories managed by admin, business catalog with PostGIS, Persian full-text search and self-hosted map, reviews with trust signals (verified check-in, reputation), Q&A, bookmarks and follows, notifications (in-app, email, SMS, web push), realtime messaging, reservations with capacity, owner dashboard with analytics, subscriptions and paid ads, AI features (review summary, FAQ answers, recommendations) through a pluggable driver, admin panel (users, businesses, moderation, translations, theme packs, integrations), short videos, PWA.

The product name is NOT final. It appears in exactly ONE place: `packages/config/src/brand.ts`. Everything else imports it. `scripts/check-brand.mjs` fails the build if the name appears anywhere else.

## 2. Stack (decided; exact versions are chosen by the prompts after reading official docs)

Every prompt that installs a dependency MUST read the current official docs first, choose the current stable version, pin it exactly in package.json (no `^`, no `~`), and record the choice in `docs/DECISIONS.md`. If you cannot read the docs, write your assumptions in `docs/DECISIONS.md`. Never change a major version without a DECISIONS entry.

- Monorepo: pnpm workspaces + Turborepo. Language: TypeScript (strict) everywhere. Node LTS (version in `.nvmrc`).
- Backend: NestJS (Express adapter) in `apps/api`. Validation with Zod schemas from `packages/contracts`.
- Database: PostgreSQL + PostGIS + pg_trgm + unaccent. ORM: Drizzle ORM + drizzle-kit migrations.
- Cache, rate limit, realtime adapter, queues: Redis + BullMQ.
- Frontend: Next.js (App Router) + React + Tailwind CSS in `apps/web`. Data fetching with TanStack Query. Forms with react-hook-form + Zod. i18n with next-intl (messages come from the API). Map: MapLibre GL with self-hosted PMTiles. Icons: lucide-react.
- Tests: Vitest (unit/integration), Supertest (API), Testing Library (components), Playwright + axe (e2e and accessibility).
- Infra: Docker Compose (db, redis, mailpit for dev; api, web, worker, db, redis, nginx or caddy for production).
- Fonts: self-hosted only (Vazirmatn for Persian/Arabic script, Inter for Latin) via fontsource npm packages. No Google Fonts, no CDN, no external scripts.

## 3. Repository layout

```text
apps/api/                 NestJS app (HTTP) and worker entry (src/worker.ts)
  src/config/             env schema (zod), config module
  src/db/                 drizzle client, schema/*.ts (one file per domain), migrate.ts, seed/
  src/common/             filters, interceptors, guards, decorators, pipes, utils
  src/modules/<name>/     one folder per domain module: <name>.module.ts, <name>.controller.ts,
                          <name>.service.ts, <name>.repository.ts, <name>.events.ts, drivers/, jobs/, __tests__/
  drizzle/                generated SQL migrations (committed)
  test/                   test helpers, factories, global setup
apps/web/                 Next.js app
  src/app/[locale]/(public)|(auth)|(account)|(dashboard)|(admin)/   route groups
  src/components/ui/      design-system components
  src/components/<area>/  feature components
  src/lib/                api client, hooks, utils, i18n helpers
  e2e/                    Playwright specs
packages/contracts/       zod schemas + inferred types + error codes shared by api and web
packages/config/          shared tsconfig, eslint, prettier, vitest base, brand.ts
infra/                    docker compose files, nginx/caddy config, db init scripts, tiles
scripts/                  cross-platform Node (.mjs) scripts only (no bash/powershell)
docs/                     PROGRESS.md DECISIONS.md DESIGN.md API.md DATA_MODEL.md SECURITY.md DEPLOYMENT.md
```

Package names: `@app/api`, `@app/web`, `@app/contracts`, `@app/config`.

## 4. Commands (root, all cross-platform)

```text
pnpm install              install
pnpm services:up          start db, redis, mailpit (docker compose)
pnpm services:down        stop them
pnpm dev                  run api, worker and web in watch mode
pnpm db:generate          generate a drizzle migration from schema changes
pnpm db:migrate           apply migrations
pnpm db:seed              run idempotent seeders
pnpm lint                 eslint
pnpm typecheck            tsc --noEmit in every package
pnpm test                 unit and integration tests
pnpm test:e2e             Playwright
pnpm build                production build of every package
pnpm verify               check scripts + lint + typecheck + test + build (same as CI)
```

Ports: web 3000, api 4000, postgres 5432, redis 6379, mailpit SMTP 1025 and UI 8025, tile server 8080.

## 5. TASK WORKFLOW (every prompt follows this exactly)

1. Read this file, `docs/PROGRESS.md` and the files your prompt names. Do not read unrelated parts of the repo.
2. Write a plan of at most 10 lines (in your reply, before coding).
3. Implement ONLY the scope of the prompt. Anything else goes to "Follow-ups" in `docs/PROGRESS.md` instead of being built.
4. Run `pnpm typecheck`, `pnpm lint` and the tests you wrote or touched. Actually run the feature (start the server, call the endpoint, open the page) and confirm the "Done when" items yourself. Fix failures before finishing.
5. Update docs as the prompt says: `docs/API.md` for every endpoint, `docs/DATA_MODEL.md` for every table, `docs/SECURITY.md` for every permission/rate limit/secret, `docs/DECISIONS.md` for every non-obvious choice, `docs/DESIGN.md` for every design rule.
6. Tick the prompt's ID in `docs/PROGRESS.md`.
7. Commit with a conventional commit message: `type(scope): summary`, and a footer line `Prompt: <ID>`. Example: `feat(auth): add refresh token rotation` + blank line + `Prompt: B1.3`.
8. Finish with at most 5 lines: what changed, how to verify, follow-ups added.

If something is ambiguous or the prompt contradicts this file, STOP and ask. Do not guess silently.

## 6. Architecture conventions

### Contract-first

- Every request body, query, param and response shape is a Zod schema in `packages/contracts/src/<domain>.ts` with an inferred type. API validates input with it (ZodValidationPipe) and the web client validates responses with it. Never duplicate a type by hand in api or web.
- Rebuild contracts (`pnpm --filter @app/contracts build`) after changing them; turbo does this automatically through `dependsOn: ["^build"]`.

### Backend modules

- One folder per domain in `apps/api/src/modules`. Controller: HTTP only (parse, authorize, call service, return). Service: business rules, transactions, events. Repository: all Drizzle queries for that domain; services never import `db` directly.
- Cross-module access only through the other module's exported service. No importing another module's repository or schema directly (schema table imports for foreign keys are allowed in `src/db/schema`).
- Side effects (email, SMS, push, analytics, AI) are queued with BullMQ, never done inline in the request path.
- Domain events use the in-process event emitter with names like `auth.login.succeeded`, `review.created`. Subscribers live in the module that reacts.
- External services (SMS, email, payment, storage, AI, geocoding) are always behind an interface with a `fake`/dev driver and real drivers selected by settings. The code must work end to end with only fake drivers.
- Runtime configuration that an admin may change lives in the `settings` table through `SettingsService` (secrets are encrypted at rest). Deployment-level configuration (database url, secrets keys, ports) lives in env and is validated in `apps/api/src/config/env.ts`. Every new setting key MUST be registered in `settings.registry.ts` with a Zod schema, default, group, and `public` flag.

### Database

- Tables: snake_case, plural. Columns snake_case. Primary key `id uuid default gen_random_uuid()`. Every table has `created_at timestamptz not null default now()`; mutable tables also have `updated_at`.
- All timestamps are stored in UTC (`timestamptz`). Business-local logic (opening hours, reservations) uses the city's IANA timezone (default `Asia/Tehran`).
- Money is an integer number of Rials (`bigint`, column suffix `_irr`). Never use floating point for money. The UI may display Toman (Rials divided by 10) through `formatMoney`.
- Locations use `geography(Point,4326)` with a GiST index. Text search uses generated `tsvector` columns, GIN and trigram indexes.
- Every schema change is a drizzle migration committed in `apps/api/drizzle`. Never edit an applied migration. Seeds are idempotent.
- Translatable entity fields (city name, category name) are stored as `jsonb` maps `{ "fa": "...", "en": "..." }` with a Zod schema `localizedTextSchema`; `fa` is required.
- Soft delete (`deleted_at`) only where a prompt says so.

### API conventions

- Base path `/api/v1`. JSON only (except multipart uploads and file serving).
- Success: `{ "ok": true, "data": <payload>, "meta": <optional> }`. Failure: `{ "ok": false, "error": { "code": "<ERROR_CODE>", "messageKey": "<i18n key>", "message": "<English fallback>", "details": <optional>, "requestId": "<id>" } }`. Error codes are an enum in `packages/contracts/src/errors.ts`; add new ones there.
- HTTP status codes: 200/201/204 success, 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict, 413 too large, 415 unsupported media, 422 business-rule violation, 429 rate limited, 500/503 server.
- Pagination: lists accept `page`/`pageSize` (max 100) or `cursor`/`limit` (max 100); response `meta` contains `page,pageSize,total` or `nextCursor`. Default sort is explicit and stable (always add `id` as the last sort key).
- Unsafe endpoints that create money or external effects accept an `Idempotency-Key` header and are safe to retry.
- Authorization is explicit on every route: `@Public()`, or `@Roles()`/`@RequirePermissions()`, plus resource-ownership checks in the service. A route without one of these is a bug.

## 7. Frontend conventions

- Route groups under `src/app/[locale]/`: `(public)`, `(auth)`, `(account)`, `(dashboard)` (owner), `(admin)` (admin and moderator). Default locale `fa` has no URL prefix; other locales are prefixed (`/en/...`).
- Server Components fetch with the server api client (cookies forwarded). Client components use TanStack Query hooks. Mutations invalidate by query-key factory `qk`.
- Forms use `useZodForm(schema)` with schemas from `@app/contracts`. Error text is translated from `messageKey`.
- Every data view implements four states: loading (skeleton), empty (EmptyState with action), error (retry), success. Every mutation shows pending, success and failure feedback.
- Use only components from `src/components/ui` and tokens from `docs/DESIGN.md`. Never hard-code colors, radii, shadows or font families; use the semantic Tailwind classes backed by CSS variables.
- Images use `next/image` with explicit sizes; user media comes from `/media/...`.
- No external network request from the browser to any third-party host (fonts, scripts, analytics, tiles, avatars). `scripts/check-no-external.mjs` enforces this on source files.

## 8. Locale, RTL and language rules

- Default language `fa` (RTL). Also `en` (LTR). Admins can add languages from the panel; every language has a `dir`. Never assume only two.
- User-facing text is NEVER hard-coded in components, controllers or emails. Use translation keys `area.section.name` (for example `auth.login.title`). Add each new key to BOTH seed files `apps/api/src/modules/i18n/seed/fa.json` and `en.json` in the same prompt. Persian text must be natural and consistent; English must be correct.
- Layout uses logical properties only: `ms-* me-* ps-* pe-* start-* end-* text-start text-end border-s border-e rounded-s rounded-e`. Never `ml/mr/pl/pr/left/right/text-left/text-right/rounded-l/rounded-r`. `scripts/check-rtl.mjs` fails on them (a line ending with `// rtl-ok` is exempt for genuinely physical needs such as map controls).
- Directional icons (arrows, chevrons) flip in RTL (`rtl:-scale-x-100`). Phone, email, URL, username and code inputs are `dir="ltr"` with `text-start`.
- Digits: store and transport ASCII digits. The server normalizes Persian and Arabic-Indic digits in all inputs. The UI shows Persian digits when locale is `fa` (through `formatNumber`), never by string replace in components.
- Dates: stored UTC. In `fa` show the Jalali calendar (`date-fns-jalali`), in other locales Gregorian. Use `formatDate/formatDateTime/formatRelative` helpers only. Week starts Saturday in `fa`.
- Persian text normalization (search, uniqueness, slugs): map Arabic `ي`→`ی`, `ك`→`ک`, remove tatweel and diacritics, unify ZWNJ and spaces. One shared implementation in `packages/contracts/src/text.ts`.
- Phone numbers: Iranian mobile numbers are normalized to E.164 `+989xxxxxxxxx` (accepts `09...`, `9...`, `+98...`, `0098...`, Persian digits).

## 9. Security rules

- No secrets in the repository. Only fake values in `.env.example`. Real secrets only in `.env` (git-ignored) or in encrypted settings.
- Validate ALL input with Zod at the edge. Reject unknown keys (`.strict()`) for bodies.
- Authorization on every resource: check role/permission AND ownership (a user edits only their own content; an owner only their own business; moderators only moderation endpoints).
- Passwords: argon2id. Tokens: short-lived access token, rotating refresh token stored hashed. Session revocation is immediate.
- Cookies: httpOnly, SameSite=Lax, Secure in production. State-changing requests authenticated by cookie must pass the Origin check (CSRF).
- Rate limit all auth, OTP, upload, review, message and search-suggest endpoints with the Redis limiter decorator. Return 429 with `Retry-After`.
- Uploads: size limit per kind, sniff real MIME type, re-encode images, strip metadata, random server-side file names, never trust client file names or MIME.
- Logs never contain passwords, tokens, OTP codes (outside dev fake drivers), secrets, or full phone/email (mask them).
- Output encoding: React escapes by default; never use `dangerouslySetInnerHTML` except for sanitized, server-rendered CMS content (sanitizer named in the prompt that needs it).
- SQL only through Drizzle or parameterized `sql` templates. Never string-concatenate user input into SQL.
- Dependencies: add only well-maintained packages; record each non-trivial one in DECISIONS.

## 10. Testing rules

- Every feature ships with tests in the same prompt: unit tests for pure logic, integration tests (Supertest + real Postgres + real Redis from `TEST_DATABASE_URL`/`TEST_REDIS_URL`) for endpoints, component tests for UI, and a Playwright spec when the prompt says so.
- Test names describe behavior: `it('rejects a refresh token that was already used and revokes the session family')`.
- Always test: the success path, validation failures, unauthenticated (401), forbidden (403), not-found (404), and at least one edge case per rule.
- Tests must be deterministic: no real network, no real time (use fake timers/clock), no dependence on test order. External drivers use the fake driver or a mocked `fetch`.
- Coverage is not a goal by itself, but every branch of auth, authorization, payment and money logic needs a test.

## 11. Code style

- TypeScript strict, no `any` (use `unknown` and narrow), no non-null assertion unless justified in a comment, no default exports except Next.js pages/layouts and config files.
- Small files (under about 300 lines) and small functions. Name things by domain (`ReservationSlotService`), not by pattern (`Manager`, `Helper`).
- Comments explain why, not what. English only in code and comments.
- Formatting by Prettier, linting by ESLint; never disable a rule without a one-line reason.
- Prefer composition and explicit dependencies. No global mutable state. No circular imports.
- Dates in code are `Date` or ISO strings with timezone; never ambiguous local strings.

## 12. Git rules

- Work on the current branch; commit after each completed prompt (one prompt = one or a few commits). Conventional commits. Never commit `.env`, uploads, build output or data volumes.
- Do not rewrite history. Do not commit failing tests or lint errors.

## 13. Scope rules

- Do exactly what the prompt says. If you discover missing work, a bug elsewhere, or a good idea, append a line to "Follow-ups" in `docs/PROGRESS.md` (format `- [ ] (<prompt ID>) description and reason`) and move on.
- If the prompt needs something that an earlier prompt should have created and it is missing, STOP and tell the user which prompt ID to run first.
- Never delete or rewrite files owned by other prompts unless your prompt says so.

## 14. Documentation rules

- `docs/API.md`: for each endpoint a block with method, path, auth, request schema name, response schema name, error codes, rate limit.
- `docs/DATA_MODEL.md`: for each table its purpose, columns of note, indexes, constraints, owner module.
- `docs/SECURITY.md`: permissions matrix, rate limits table, secrets inventory, threat notes.
- `docs/DECISIONS.md`: dated entries (see file for the format).
- `docs/DESIGN.md`: the only source of truth for visual rules.
