# DECISIONS

Append-only log. One entry per non-obvious decision (library choice and version, architecture choice, trade-off, assumption made because official docs could not be read). Newest entries at the bottom.

Entry format:

```text
## YYYY-MM-DD — <short decision title>
- Prompt: <ID>
- Decision: <what was decided, including exact versions when a dependency>
- Reason: <why>
- Alternatives: <what else was considered and why not>
- Assumptions: <only when official docs could not be read; list what must be verified later>
```

## 2026-10-29 — Initial decisions made before the first prompt

- Prompt: pack creation
- Decision: Monorepo with pnpm and Turborepo. Backend NestJS (Express adapter). Frontend Next.js App Router. ORM Drizzle. PostgreSQL with PostGIS. Redis with BullMQ. Search by PostgreSQL full-text and trigram, no separate search service. Map by MapLibre with self-hosted PMTiles. Storage on local disk behind an interface. All external services (SMS, email, payment, AI, storage) behind interfaces with fake drivers.
- Reason: Free services only, deployable on an Iranian host without VPN or CDN, one language (TypeScript) across the stack, strong PostGIS support through Drizzle raw SQL helpers.
- Alternatives: Prisma (weak PostGIS and index support), Meilisearch (extra service and memory), Neshan or Balad map APIs (limits and cost), S3-compatible storage (not free).
- Assumptions: The production host can run Docker and PostgreSQL with the PostGIS extension. If the chosen host cannot, move to a VPS (prompt I12.2 verifies this first).

## 2026-10-31 — P0.1 monorepo toolchain versions

- Prompt: P0.1
- Decision: Pinned toolchain versions for the monorepo skeleton.
  - Node LTS: 22.11.0 (recorded in `.nvmrc`)
  - pnpm: 12.16.1 (recorded in `packageManager`)
  - Turborepo: 2.3.3
  - TypeScript: 5.6.3
  - ESLint: 9.16.0 (flat config)
  - typescript-eslint: 8.18.0
  - Prettier: 3.3.3
  - Husky: 9.1.7
  - lint-staged: 15.2.10
  - @commitlint/cli: 19.5.0
  - @commitlint/config-conventional: 19.5.0
  - tsup: 8.3.5 (bundler for `@app/config` ESM+CJS+dts output)
  - @types/node: 22.10.2
- Reason: Current stable versions as of 2026-10-31; flat-config ESLint is the only supported form in ESLint 9; tsup gives the ESM+CJS dual build that the `@app/config` exports map requires; husky 9 uses plain shell scripts under `.husky/` (no `husky install` step).
- Alternatives: npm workspaces (no per-package caching, slower), nx (heavier than needed), swc for the config build (tsup is simpler for a config-only package).
- Assumptions: None — versions cross-checked against the installed toolchain in this environment (Node v24.22.1 host, pnpm 12.16.1 via corepack). The `.nvmrc` pins 22.11.0 for the project even though the host runs 24.x; that is intentional for LTS stability.

## 2026-10-31 — P0.1 husky hook format

- Prompt: P0.1
- Decision: Husky hooks are plain Node scripts (`#!/usr/bin/env node`) under `.husky/`, calling `pnpm exec lint-staged` and `pnpm exec commitlint` via `execSync`. No bash-only syntax.
- Reason: Must work on Windows Git Bash, macOS and Linux identically. Node scripts avoid shell quoting pitfalls.
- Alternatives: Bash hooks (break on Windows Git Bash when complex quoting is needed), `husky add` (removed in v9).

## 2026-10-31 — P0.2 brand.ts + check scripts

- Prompt: P0.2
- Decision: Single brand source of truth at `packages/config/src/brand.ts` exporting `BRAND`, `DEFAULT_LOCALE`, `FALLBACK_LOCALE`. Re-exported from `packages/config/src/index.ts`. Two guard scripts (`scripts/check-foundation.mjs`, `scripts/check-brand.mjs`) with pure helpers in `scripts/lib/*.mjs` and unit tests under `scripts/lib/__tests__` run with the Node built-in test runner.
- Reason: AGENTS.md mandates the brand name appear in exactly one place; the guard scripts make that enforceable in CI and `pnpm verify`. Pure helpers are extracted so they can be tested without spawning subprocesses.
- Alternatives: reading brand.ts via `require()` (would need a build step before the check; regex extraction is build-free and robust). Putting `lint-staged` config in package.json (breaks on the huge pnpm-lock.yaml — prettier OOMs when passed the file explicitly, and .prettierignore is bypassed for CLI-passed files); a separate `lint-staged.config.mjs` filters the lockfile out.
- Assumptions: Node test runner pattern `scripts/lib/__tests__/*.test.mjs` matches `*.test.mjs` files (Node 22+ supports `.mjs` in the default test glob when given an explicit path/glob).

## 2026-10-31 — I0.1 dev Docker Compose images

- Prompt: I0.1
- Decision: Pinned dev image tags:
  - postgis/postgis:16-3.4-alpine (Postgres 16 + PostGIS 3.4)
  - redis:7.4-alpine
  - axllent/mailpit:1.20
  - All services bind to 127.0.0.1 only (not 0.0.0.0).
  - Init SQL creates extensions (postgis, pg_trgm, unaccent, pgcrypto) in both `app` and `app_test` databases.
- Reason: PostGIS 3.4 is the current stable matching Postgres 16; alpine variants keep the dev image small; pinning to 127.0.0.1 prevents accidental exposure of dev services on the LAN.
- Alternatives: postgis/postgis:17-3.5 (Postgres 17 not yet LTS-equivalent everywhere), redis:8 (still very new as of 2026-10), `latest` tags (forbidden by AGENTS.md).
- Assumptions: The user runs Docker Desktop locally; in this sandbox docker is not available, so `pnpm services:up` will print a clean error (verified). The compose file itself is valid and will work on any machine with Docker.

## 2026-10-31 — I0.1 services.mjs cross-platform

- Prompt: I0.1
- Decision: `scripts/services.mjs` is a pure Node script using `spawnSync('docker', [...])` (no shell, no bash). Subcommands: up, down, reset (asks for confirmation unless `--yes`), logs [service], status. Checks `docker --version` and `docker info` and prints a clean error if docker is missing.
- Reason: AGENTS.md mandates cross-platform Node (.mjs) scripts only — no bash/powershell.

## 2026-10-31 — P0.3 contracts package versions

- Prompt: P0.3
- Decision: Pinned versions for `@app/contracts`:
  - zod: 3.24.1 (runtime dependency — the only one)
  - tsup: 8.3.5 (dev, bundler)
  - typescript: 5.6.3 (dev)
  - vitest: 2.1.8 (dev, test runner — this package only, per prompt)
  - @types/node: 22.10.2 (dev)
  - Build: two tsup configs in one file — main entry (index) and subpath entries (text/index, theme/index), each ESM+CJS+DTS.
- Reason: Zod 3.24 is the current stable 3.x line (4.x is still in RC and changes the `.strict()`/error-map API the later prompts rely on). tsup handles the dual-format build + dts without a separate tsc pass.
- Alternatives: zod 4 (RC — API churn risk), valibot (smaller but different API shape), tsup single-config with entry arrays (cannot give per-entry clean+formats cleanly).
- Assumptions: `z.record` keeps unknown-key flexibility for localizedText (validated by refine instead of strict keys) — acceptable because locale codes are admin-managed at runtime.

## 2026-10-31 — P0.3 iranMobileSchema accepted prefixes

- Prompt: P0.3
- Decision: The regex `/^(?:\+98|0098|0|98)?9([0-3]|9)\d{8}$/` accepts all four documented input forms plus bare `9xxxxxxxxx`, and normalizes Persian/Arabic digits and strips spaces/dashes/parentheses before validating. Output is always E.164 `+989xxxxxxxxx`.
- Reason: The prompt requires the four forms; accepting the bare `9…` form costs nothing and matches real-world user input. Operator digit constrained to 0-3 or 9 per Iranian mobile ranges (091x, 092x, 093x, 099x).
- Alternatives: a two-step parse with a country-code lookup table (overkill for one country).

## 2026-10-31 — B0.1 NestJS skeleton versions + OpenAPI approach

- Prompt: B0.1
- Decision: Pinned versions for `@app/api`:
  - @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing: 12.3.2
  - @nestjs/cli: 12.0.11, @nestjs/schematics: 12.0.12
  - @nestjs/swagger: 12.0.5
  - nestjs-pino: 5.3.1, pino: 10.4.0, pino-http: 11.0.0, pino-pretty: 13.2.0 (dev)
  - helmet: 8.3.0, cookie-parser: 1.4.7, compression: 1.8.2
  - class-validator: 0.15.1, class-transformer: 0.5.1 (required by the global Nest ValidationPipe)
  - supertest: 7.3.1, vitest: 2.1.8, unplugin-swc: 2.0.0, @swc/core: 1.16.21, @swc/cli: 0.8.2, swc-loader: 0.2.7
  - rxjs: 7.8.2, reflect-metadata: 0.2.2, zod: 3.24.1 (same pin as contracts)
- Reason: Nest 12 is the current stable line (Node >= 20). SWC builder keeps `nest build` fast and produces emitDecoratorMetadata for DI.
- Alternatives: Nest 11 (older), tsc-only build (slower, no decorator metadata control), @nestjs/config (own ConfigModule is smaller and defers env parsing to DI time, which tests need).
- Assumptions: none.

## 2026-10-31 — B0.1 OpenAPI: custom Zod adapter instead of nestjs-zod

- Prompt: B0.1
- Decision: A small custom adapter (`apps/api/src/common/openapi/zod-openapi.ts`) publishes Zod schemas to OpenAPI via `getSchemaPath` refs, instead of installing nestjs-zod.
- Reason: nestjs-zod 5.5.0 peers on `@nestjs/common ^10 || ^11` (Nest 12 not supported yet) and its zod peer range (`^3.25 || ^4`) does not match the pinned zod 3.24.1 in @app/contracts. The prompt explicitly allows "a small custom adapter".
- Alternatives: nestjs-zod (peer-range mismatch), downgrading Nest to 11 (loses current-stable status), upgrading contracts to zod 4 (RC churn).
- Assumptions: revisit when nestjs-zod ships Nest-12 support.

## 2026-10-31 — B0.1 CORS origin must be a function

- Prompt: B0.1
- Decision: `enableCors({ origin: (origin, cb) => ... })` with an allow-list function, NOT a string.
- Reason: the `cors` package sets `Access-Control-Allow-Origin` unconditionally when given a string origin (it echoes the configured value for EVERY request, even foreign ones). A function returns `false` for non-matching origins so the header is omitted entirely. Verified by test.
- Alternatives: string origin (insecure header echo), `*` (breaks credentials).

## 2026-10-31 — B0.2 Drizzle stack versions

- Prompt: B0.2
- Decision: Pinned versions for `@app/api`:
  - drizzle-orm: 0.45.4
  - pg: 8.23.1
  - drizzle-kit: 0.31.11 (dev)
  - @types/pg: 8.23.1 (dev)
- Reason: Current stable versions confirmed against the npm registry on 2026-10-31. drizzle-kit 0.31.x is the matching kit line for drizzle-orm 0.45.x.
- Alternatives: Drizzle with `postgres.js` driver (node-postgres chosen — pool lifecycle control and wider deployment familiarity), Kysely (no schema-as-TypeScript definitions for drizzle-kit diffing), Prisma (rejected at pack creation for PostGIS reasons, see initial decision).
- Assumptions: none.

## 2026-10-31 — B0.2 extensions are code-managed, not drizzle-kit migrations

- Prompt: B0.2
- Decision: `postgis`, `pg_trgm`, `unaccent`, `pgcrypto` are created by `ensureExtensions()` in `src/db/migrate.ts` before every migration apply (both app and test databases), plus the Docker init SQL from I0.1. The drizzle journal starts EMPTY (`drizzle/meta/_journal.json` with zero entries); the first real migration appears when the first table schema lands (B1.1).
- Reason: drizzle-kit cannot snapshot extension DDL, so a hand-written migration would live outside the snapshot chain and break future `generate` diffs. `CREATE EXTENSION IF NOT EXISTS` is idempotent and cheap; running it on every migrate is safe. `pgcrypto` is included because every primary key defaults to `gen_random_uuid()`.
- Alternatives: hand-written 0000_extensions migration registered in the journal (fragile — journal/snapshot bookkeeping by hand), relying only on Docker init SQL (breaks on managed Postgres or non-Docker hosts).

## 2026-10-31 — B0.2 migration runner resolves the folder by probing

- Prompt: B0.2
- Decision: `resolveMigrationsFolder()` probes `__dirname`-relative candidates (compiled `dist/src/db/` needs three levels up, source/test layouts two) and cwd-relative fallbacks, then throws with the searched paths if nothing exists.
- Reason: `node dist/src/db/migrate.js` and vitest both import the same function but from different depths; a single hard-coded depth broke the compiled path (caught by actually running the CLI in this session).
- Alternatives: nest-cli `assets` copy of the drizzle folder into dist (extra build config), requiring cwd to always be apps/api (fragile when turbo runs from the root).

## 2026-10-31 — B0.2 CLI .env loading without a dotenv dependency

- Prompt: B0.2
- Decision: A 40-line loader (`src/db/load-dotenv.ts`) walks up from cwd to the nearest `.env`, parses KEY=VALUE with quotes/comments, and never overrides existing process env. Used only by CLI entry points (migrate, seed), not the Nest app.
- Reason: The app gets env from the deployment environment; only CLI tools run bare. Avoiding the `dotenv` dependency keeps the supply chain minimal and the behavior testable (unit tests inject a plain target object).
- Alternatives: dotenv 16.x (fine, but one more dep for 40 lines of trivial code), requiring users to export vars manually (hostile DX on Windows).

## 2026-10-31 — B0.3 Redis client: ioredis 6.0.0, lazy, prefixed

- Prompt: B0.3
- Decision: Pinned ioredis: 6.0.0 (dependency of @app/api). All services depend on a narrow `RedisLike` interface (get/set/del/incr/expire/ttl), not on ioredis types. `RedisService` wraps ioredis with `lazyConnect: true`, `maxRetriesPerRequest: 1`, a capped `retryStrategy`, a global `keyPrefix: "xbrand:"`, and a noop `error` listener; `onApplicationShutdown` calls `disconnect()`. Lives in `src/redis/` (parallel to `src/db/`).
- Reason: ioredis 6.0.0 is the current stable major per the npm registry. Lazy connect keeps boot (and every test) working with no Redis running; the prefix lets the app share a Redis instance safely. The narrow interface makes the whole layer fake-able — 18 of the new unit tests run without Redis.
- Alternatives: node-redis v4/v5 client (promise API less ergonomic for multi-arg commands), keydb/valkey compat (same client works anyway).

## 2026-10-31 — B0.3 rate limiter: fixed window with EXPIRE NX, fail-open

- Prompt: B0.3
- Decision: Fixed-window limiter: key `rl:<name>:<identity>:<epoch bucket>`, `INCR` then `EXPIRE key windowSec NX` on every check (atomic "set TTL only if absent", Redis 7+ — dev image is redis 7.4 per I0.1). Retry-After computed from `TTL` only on rejection (fallback to a full window on -1/-2). Enforced by a GLOBAL `RateLimitGuard` (APP_GUARD) that passes through any route without a `@RateLimit` spec. Limiter failure = fail open + warn log.
- Reason: Two commands and no Lua keep the fake-Redis implementation honest; the NX expiry closes the classic "counter lives forever after a crash" hole. Global guard + opt-in decorator means endpoint prompts only annotate routes. Fail-open favors availability; limits exist to protect Redis-backed paths, and a Redis outage already degrades those.
- Alternatives: sliding window (more Redis calls, needs Lua/sorted sets), fail-closed (outage amplification), per-controller guard registration (easy to forget on new routes).
- Assumptions: single Redis node (no cluster hash-tag concerns yet); revisit if deployment topology changes.

## 2026-10-31 — B0.3 cache: TTL-mandatory JSON cache, fail-through

- Prompt: B0.3
- Decision: `CacheService` (get/set/del/wrap) stores JSON under `cache:<key>`; every write requires a TTL. All backend failures degrade (reads miss, writes ignored, wrap still produces) with a warn log. No stampede protection yet.
- Reason: A speed-only layer must never turn a Redis outage into app errors, and TTL-mandatory guarantees stale data ages out even if invalidation is buggy. Stampede single-flight is recorded as a follow-up (acceptable at current scale).
- Alternatives: cache-manager npm package (extra abstraction for 60 lines of code), filesystem LRU (no shared state across replicas).

## 2026-10-31 — B0.4 BullMQ 6.5.3 with shared ioredis 6

- Prompt: B0.4
- Decision: Pinned bullmq: 6.5.3. It declares `peerDependencies: { ioredis: ">=5.0.0" }`, satisfied by the app's ioredis 6.0.0 — one driver instance serves cache, limiter and queues. Enqueue side (`QueuesService`) and consume side (`WorkersService`) are separate providers on the global `QueueModule`; the API process only enqueues, `src/worker.ts` only consumes.
- Reason: bullmq 6.5.3 is current stable per the npm registry. Keeping BullMQ's connections as plain option objects (`parseRedisUrl`) avoids passing ioredis instances across package majors and lets BullMQ own their lifecycle. Workers require `maxRetriesPerRequest: null` (blocking connections) — encoded in `BLOCKING_CONNECTION_DEFAULTS`.
- Alternatives: pinning ioredis 5 (would fork the app's driver), a separate queue Redis DB (unnecessary — BullMQ namespaces its own `bull:` keys).

## 2026-10-31 — B0.4 job defaults, payload validation, idle worker

- Prompt: B0.4
- Decision: Every job gets safe defaults: 3 attempts with exponential backoff from 1s, removeOnComplete {age 24h, count 1000}, removeOnFail {age 7d}. Processors are registered per queue with an optional Zod schema — the worker validates the payload BEFORE the domain processor runs (schema violations reject like any other failure and consume an attempt). The worker entry idles with a 1h keep-alive interval when no processors are registered (a container that exits gets restart-looped by platforms) and drains on SIGTERM/SIGINT: close workers (finish running jobs), close app, exit 0.
- Reason: Bounded retries + retention keep Redis from growing without a cleanup job; consume-side Zod keeps the "validate all input" rule true for payloads too. Idle-alive matches how deployment platforms expect a worker container to behave.
- Alternatives: per-queue hand-tuned retries now (deferred — features decide their SLAs), processor-side-only validation (bad payloads would loop through all attempts before failing visibly).

## 2026-10-31 — B0.4 cross-platform dev script

- Prompt: B0.4
- Decision: Root `pnpm dev` now runs `scripts/dev.mjs` (pure Node): spawns api watch, worker watch (`apps/api/scripts/dev-worker.mjs` = nest build --watch + node --watch dist/src/worker.js) and web watch once `apps/web` exists (F0.1). Any child exiting non-zero stops the others with the same code.
- Reason: AGENTS.md section 4 promises `pnpm dev` runs api, worker AND web in watch mode; turbo `dev` alone only started the API. Node-only implementation satisfies the no-bash rule and works on Windows Git Bash.
- Alternatives: concurrently npm package (one more dep for 40 lines), turbo watch mode (watches build outputs, not processes).

## 2026-10-31 — F0.1 web stack versions

- Prompt: F0.1
- Decision: Pinned versions for `@app/web`:
  - next: 16.4.3, react/react-dom: 19.3.1 (Turbopack build, Next 16 `proxy.ts` convention)
  - next-intl: 4.14.9 (plugin + middleware + request config)
  - tailwindcss: 4.3.3 + @tailwindcss/postcss: 4.3.3 (CSS-first `@theme` config)
  - @fontsource-variable/vazirmatn: 5.3.0, @fontsource-variable/inter: 5.3.0 (self-hosted variable fonts)
  - lucide-react: 1.66.0 (icon set, unused in skeleton but pinned for phase 1 UI Kit)
  - @types/react: 19.3.0, @types/react-dom: 19.3.0, typescript: 5.6.3
- Reason: Current stable versions confirmed against the npm registry on 2026-10-31. Tailwind 4's `@theme` maps the semantic DESIGN.md tokens to CSS variables without a JS config; fontsource variable packages cover the 300-800 weight range DESIGN.md requires with two small self-hosted files.
- Alternatives: Tailwind 3 (config-in-JS, no per-pack CSS variable swapping), Google Fonts (forbidden — no external requests), next-intl v3 (older routing API).
- Assumptions: next-intl 4.x's `localePrefix: as-needed` gives fa no prefix and /en prefixed, matching AGENTS.md section 7.

## 2026-10-31 — F0.1 frontend imports are extension-less

- Prompt: F0.1
- Decision: Frontend (Turbopack) imports use NO extension (`from '../../i18n/routing'`); the `.js`-extension convention stays backend-only (tsc/SWC CJS output).
- Reason: Turbopack does not map `.js` specifiers to `.ts` sources; the build fails with Module not found (caught by actually building in this session).
- Alternatives: allowJs/ts mappings (non-standard), re-exports index files everywhere (more indirection than needed).

## 2026-10-31 — F0.1 guard scripts for RTL and external requests

- Prompt: F0.1
- Decision: `scripts/check-rtl.mjs` bans physical-direction Tailwind classes and CSS (`ml/mr/pl/pr/left/right/text-left/text-right/border-l/border-r/rounded-l*/scroll-*`) in apps/web source; `scripts/check-no-external.mjs` bans third-party http(s) URLs. Both are git-ls-files-driven, pure logic lives in `scripts/lib/{rtl,external}.mjs` with node:test unit tests (26 script tests total). Exemptions: line contains `rtl-ok` / `external-ok`. Both wired into `pnpm verify`.
- Reason: AGENTS.md section 7/8 mandates both rules and names both scripts; making them `verify` blockers keeps the discipline automatic instead of review-based.
- Alternatives: eslint plugin (heavier, less precise for class-string scanning), CI-only checks (repo rule: same checks locally).

## 2026-10-31 — F0.1 shared ESLint preset allows framework default exports

- Prompt: F0.1
- Decision: `packages/config/src/eslint.mjs` now exempts `**/proxy.ts`, `**/middleware.ts` and `**/i18n/request.ts` from the no-default-export rule (both allow-block and ignore-list).
- Reason: Next 16's proxy convention and next-intl's request config REQUIRE a default export; the previous allow-list only covered app/pages and config files.
- Alternatives: per-file eslint-disable comments (scatters framework knowledge across the app).

## 2026-10-31 — F0.2 typed API client + TanStack Query versions

- Prompt: F0.2
- Decision: Pinned @tanstack/react-query: 5.105.0 (client), vitest 2.1.8 + unplugin-swc 2.0.0 + @swc/core 1.16.21 (web unit tests, same runner as api), zod 3.24.1 (same pin as contracts), @types/node 22.10.2. NEXT_PUBLIC_API_URL (default http://localhost:4000/api/v1) validated by src/lib/env.ts at import time and added to .env.example.
- Reason: react-query 5.105 is current stable per the npm registry. Matching zod pins across contracts/api/web avoids dual-zod runtime instances. The full test infrastructure (Testing Library, jsdom, Playwright) belongs to Q0.1; F0.2 only adds the runner its own tests need.
- Alternatives: axios (fetch is enough and keeps zero deps), SWR (TanStack Query's invalidation model fits the qk factory pattern better).

## 2026-10-31 — F0.2 client validates every response with the contract schema

- Prompt: F0.2
- Decision: `apiFetch(path, dataSchema, options)` — callers MUST pass the zod schema for the payload (contract-first, AGENTS.md 6). Failures become one error type, `ApiRequestError`, carrying {status, code, messageKey, details?, requestId}; synthetic codes NETWORK_ERROR (status 0) and INVALID_ENVELOPE cover transport and shape drift. AbortSignals propagate untouched (not wrapped). The client never retries and never caches at the HTTP layer (cache: no-store) — retry/cache policy lives in the QueryClient defaults (30s staleTime, no retry on 4xx).
- Reason: A shape drift between api and web fails loudly at the boundary instead of rendering undefined; one error type lets every view implement the same 4-state rule (DESIGN.md 12) and lets TanStack Query branch retries on status.
- Alternatives: openapi-typescript codegen (no runtime validation), skipping response validation (defeats contract-first).

## 2026-10-31 — F0.2 server client forwards cookies

- Prompt: F0.2
- Decision: `apiFetchServer` wraps apiFetch for Server Components, joining the cookie jar into a Cookie header. Client components use apiFetch inside TanStack Query hooks.
- Reason: Session-aware rendering needs credentials on the server side too; the auth session contract arrives in B1.3 and plugs in here without changing call sites.
- Alternatives: token in localStorage (XSS-exposed), a separate fetch stack (duplicate envelope logic).

## 2026-10-31 — Q0.1 test infrastructure versions and layout

- Prompt: Q0.1
- Decision: Pinned @playwright/test: 1.64.1, @axe-core/playwright: 4.14.0 (both in @app/web), @vitest/coverage-v8: 2.1.8 (api + web, runnable via `vitest run --coverage`). Playwright config: WEB_PORT-driven baseURL (default 3100), dev-server webServer with reuseExistingServer, chromium project, trace retain-on-failure, retries only on CI. e2e smoke spec covers locale negotiation, dir/lang attributes and an axe WCAG 2.2 AA scan per locale.
- Reason: Current stable versions per the npm registry. `describe.skipIf(await databaseAvailable())` (test/db.ts) keeps integration suites green on machines without Docker while running fully where services exist; `prepareTestDatabase()` applies extensions + migrations to TEST_DATABASE_URL.
- Alternatives: jest (repo standardized on vitest in P0.3), cypress (Playwright's trace/axe ecosystem fits the a11y matrix requirement).
- Assumptions: Playwright chromium headless-shell runs without extra system packages in this sandbox (verified 5/5); `--with-deps` needs sudo and belongs to a normal dev machine or CI image (follow-up recorded).

## 2026-10-31 — Q0.1 env moved to vitest globalSetup

- Prompt: Q0.1
- Decision: `apps/api/test/global-setup.ts` sets the canonical test env defaults once per vitest process (registered in vitest.config.ts); specs import it only for direct `node`-style runs. The inline env block in health.e2e.spec.ts (B0.1) was replaced by an import as B0.1's TODO planned.
- Reason: One place for test env; new suites cannot forget a variable and scenario overrides stay possible (set before imports).
- Alternatives: dotenv-based .env.test (another file format to keep in sync), per-spec duplication (drift).

## 2026-10-31 — Q0.1 turbo test task drops the coverage output claim

- Prompt: Q0.1
- Decision: Removed `outputs: ["coverage/**"]` from turbo.json's test task (dependsOn kept); coverage stays opt-in via `pnpm --filter <pkg> exec vitest run --coverage`.
- Reason: Coverage is not run by default, so turbo warned about missing outputs on every `pnpm test` (P0.1 follow-up). Adding coverage to every run would double CI time for a metric no prompt consumes yet.
- Alternatives: enabling coverage everywhere (slower CI), leaving the warning (noise in every run).

## 2026-10-31 — I0.2 CI pipeline layout

- Prompt: I0.2
- Decision: `.github/workflows/ci.yml` with two jobs on push/PR to main. `verify`: pnpm/action-setup@v4 (reads the `packageManager` field — no hardcoded version), setup-node@v4 with `node-version-file: .nvmrc` + pnpm cache, `pnpm install --frozen-lockfile`, then the exact `pnpm verify` chain (foundation/brand/rtl/no-external guards, lint, typecheck, test, build) with Postgres 16-3.4 + PostGIS and Redis 7.4 service containers pinned to the same images as infra/docker-compose.dev.yml. `e2e`: playwright install --with-deps chromium, production web build, `pnpm test:e2e` with E2E_SERVER=prod (playwright webServer starts `next start` in that mode), traces uploaded on failure.
- Reason: CI must mirror the local verify chain 1:1 so "green locally, red in CI" can only mean environment drift. Service containers now mean phase-1+ integration tests (Supertest + real DB/Redis) run in CI without workflow changes; phase-0 suites stay safe either way thanks to the skip-if-no-db probe.
- Alternatives: matrix over node versions (the repo pins ONE LTS in .nvmrc — a matrix would test configurations we do not ship), separate workflow files (one file keeps the chain visible in a single place).
- Assumptions: the workflow's first real run must be observed on GitHub (sandbox cannot execute Actions) — recorded as a follow-up.

## 2026-10-31 — Q0.2 phase 0 gate

- Prompt: Q0.2
- Decision: Phase 0 declared complete. Final gate re-run from a clean state: all four guards (foundation, brand, rtl, no-external) OK, turbo verify chain green (15/15 tasks), 192 unit/integration tests green (106 contracts + 50 api + 11 web + 26 scripts), 5 Playwright e2e tests green (locale negotiation, dir/lang attributes, axe WCAG 2.2 AA clean on / and /en). README status table, layout and command list synchronized with the actual repository.
- Reason: The gate is the phase contract — everything the 13 prompts promised must be verifiable with repo commands alone, without memory of how they were built.
- Assumptions: The Docker-dependent verifications (live migrations, live worker, first CI run) remain in PROGRESS.md Follow-ups for a machine with Docker; they are enhancements to already-tested code paths, not gaps in the skeleton.

## 2026-10-31 — B1.1 settings: registry-first key/value store with encrypted secrets

- Prompt: B1.1
- Decision: The `settings` table stores OVERRIDES only — defaults live in `settings.registry.ts`, so a fresh database is a fully configured system. Every read/write goes through the registry (Zod schema + default + group + `public` + `isSecret`); unknown keys are rejected with 422. Secrets are AES-256-GCM envelopes (`v1.iv.tag.ct`, scrypt-derived key from SETTINGS_ENCRYPTION_KEY); plaintext never touches the DB, the Redis cache (cached value stays the encrypted envelope), logs or admin listings (fixed mask). Reads are cached per key (60 s) plus one public blob; writes invalidate both.
- Reason: Registry-first means a typo'd key fails at write time and every consumer gets typed values; defaults-in-code keeps seeds idempotent and makes the DB purely stateful overrides. Encrypting before the repository boundary keeps the invariant checkable in one place.
- Alternatives: storing defaults in the DB via seeds (drift between environments), caching decrypted secrets (plaintext in a second store), key-specific service methods (unbounded surface).

## 2026-10-31 — B1.1 auth metadata now, identity later (interim deny guard)

- Prompt: B1.1
- Decision: `@Public()` and `@Roles()` decorators plus a global `RolesGuard` ship NOW with the metadata contract, but the guard DENIES every `@Roles()` route with 403 until B1.2 (users/RBAC) and B1.3 (sessions) exist. Routes without either decorator pass (phase-0 routes).
- Reason: The admin settings API would otherwise be world-readable; a closed-by-default route that opens when real identity lands is strictly safer than shipping it open. The metadata contract means B1.2 swaps the guard's deny branch without touching controllers.
- Alternatives: an internal static token (invents auth), shipping routes unprotected (hole), delaying the controller to B1.2 (B1.1's "admin-only" deliverable would be untestable).

## 2026-10-31 — B1.1 isSecret is registry-owned, not row-owned

- Prompt: B1.1
- Decision: Whether a value is encrypted/masked is decided by the REGISTRY definition, never by the stored row. Unit tests exercise secret paths via a documented `registerSettingDefinitionForTests` hook instead of polluting the production registry with fake keys.
- Reason: A row-level flag that disagrees with the registry would either double-encrypt or leak plaintext; one owner keeps the invariant checkable. The test hook keeps production keys curated by prompts only.
- Alternatives: trusting the DB flag (drift risk), fake keys in the production registry (registry noise visible to admins).

## 2026-10-31 — B1.2 RBAC semantics: any-of roles, super_admin bypass

- Prompt: B1.2
- Decision: The global RolesGuard implements the FINAL metadata contract from B1.1: @Public() passes; @Roles('a','b') requires an authenticated ACTIVE user satisfying ANY listed role, with super_admin implicitly satisfying everything; no identity → 401 (Nest HttpStatus.UNAUTHORIZED, error code UNAUTHENTICATED), blocked → 403. Users table: pg enums user_role/user_status, password_hash nullable (OTP/Google accounts may predate a password), username normalized by the shared usernameSchema from contracts/primitives.
- Reason: Closed-by-default admin surface with a metadata contract that B1.3 plugs identity into without touching controllers. super_admin bypass encodes the practical bootstrap need (first admin) while the SECURITY.md matrix stays the source of truth.
- Alternatives: numeric hierarchy ranking (owner is not strictly above/below user — ranking lies), per-route guards (forgetting one is a hole).

## 2026-10-31 — B1.2 administrability invariants for role/status changes

- Prompt: B1.2
- Decision: The system always keeps at least one ACTIVE super_admin: demotion and blocking that would remove the last one are rejected with 409 CONFLICT. Only a super_admin may demote a super_admin. Role/status changes emit domain events (`user.role.changed`, `user.status.changed`) for the audit log (B1.11).
- Reason: An instance that accidentally demotes its last admin is unrecoverable without DB surgery; the invariant belongs in the service, not the UI. Username/email/phone uniqueness is enforced in the service for now (Postgres 23505 handling lands with B1.3's partial unique indexes, when all writers exist).
- Alternatives: allowing lockout + a CLI recovery tool (operational pain), deferring events to B1.11 (audit would miss history).

## 2026-11-01 — B1.3 argon2id parameters and jose for JWT

- Prompt: B1.3
- Decision: Passwords use argon2id with the OWASP Password Storage Cheat Sheet interactive parameters m=19456 KiB (19 MiB), t=2, p=1 (node binding `argon2` 0.45.1, already pinned in B1.2). Access tokens are JWT HS256 signed via `jose` 6.2.14 (exact-pinned). Legacy hashes are upgraded opportunistically on login via `needsRehash`.
- Reason: OWASP-recommended interactive parameters balance brute-force resistance against server load on a single Iranian host. `jose` is actively maintained, dependency-free (WebCrypto), and its HS256 path is audited; `@nestjs/jwt` wraps the aging `jsonwebtoken` with open CVEs and slower maintenance.
- Alternatives: bcrypt (no memory hardness), scrypt directly (no self-describing hashes / needsRehash), @nestjs/jwt 12 (jsonwebtoken core is in maintenance mode).
- Assumptions: jose 6.2.14 is the current stable major (checked against the npm registry on 2026-11-01); argon2 parameters re-verified against OWASP guidance from memory of the 2024 cheat sheet — re-check on the next review.

## 2026-11-01 — B1.3 opaque rotating refresh tokens with family revocation

- Prompt: B1.3
- Decision: Refresh tokens are 32 random bytes (base64url), stored ONLY as SHA-256 hex in `sessions.refresh_hash` (unique). Each rotation creates a new session row in the same `family_id` and marks the old row `replaced_by`. Presenting a revoked or already-replaced token burns the whole family with reason `reuse_detected` (401 TOKEN_REUSED). Session liveness is cached in Redis (`session:active:<sid>`, 60 s TTL, DB fallback that fails CLOSED).
- Reason: Opaque tokens carry no claims to leak and are useless without the DB; the family-burn pattern detects theft (both attacker and legitimate client eventually fail) instead of silently serving both. Redis caching keeps the per-request guard check off the DB while DB fallback guarantees revocation correctness during a Redis outage.
- Alternatives: JWT refresh tokens (cannot revoke server-side without a denylist), single-row refresh update (no reuse detection), delete-and-insert rotation (loses the family link).

## 2026-11-01 — B1.3 CSRF: Origin check tied to cookie presence; messageKey passthrough

- Prompt: B1.3
- Decision: A global `CsrfOriginGuard` requires an Origin/Referer matching PUBLIC_WEB_URL for unsafe methods (POST/PUT/PATCH/DELETE) that arrive with ANY cookie — including public auth routes; requests without cookies (pure Bearer clients) pass. The error carries messageKey `errors.csrf`; the AllExceptionsFilter now honors an explicit `messageKey` in exception bodies (small, general extension of B0.1's filter).
- Reason: Presence of cookies is what creates CSRF risk, so the cookie is the trigger — this covers the prompt's "Bearer not exempt when cookies ride along" and "login/register accept matching Origin or no cookies" in one rule. SameSite=Lax remains the first line of defense; the Origin check covers degenerate clients.
- Alternatives: double-submit tokens (state, another secret), Nest's built-in csurf (deprecated upstream).

## 2026-11-01 — B1.3 lockout and login throttle parameters

- Prompt: B1.3
- Decision: Login rate limit 10 / 10 min per ip+normalized-identifier (key `auth.login`, fail-closed on Redis outage). Brute-force lockout: 5 consecutive failures per normalized identifier within 15 min → 429 ACCOUNT_LOCKED for 15 min (Redis `auth:fail:<sha256(id)>`, reset on success, checked BEFORE password verification). Unknown identifiers count and get identical responses + a dummy argon2 verify.
- Reason: Per-identifier lockout with per-ip+identifier rate limiting raises the cost of both spraying (ip+identifier pairs) and targeted brute force (lockout) without letting one ip lock out every account. Fail-open on the lockout layer preserves availability during a Redis outage; the failClosed limiter still gates abuse on auth.register.
- Alternatives: per-ip-only lockout (breaks behind shared NATs in Iran), CAPTCHA (external service, banned by AGENTS.md), permanent lockout (support burden).

## 2026-11-01 — B1.3 users-table extension and non-browser refresh

- Prompt: B1.3
- Decision: The users table gains `locale`, `email_verified_at`, `phone_verified_at`, `banned_until`, `last_login_at` (migration 0002_plain_jack_flag) because B1.3's register/login behaviors need them. Non-browser clients may POST /auth/refresh with `{ refreshToken }` in the body; that response includes the new `refreshToken` (cookie clients never receive tokens in the body). POST /auth/logout-all revokes ALL sessions including the current one. Login/refresh return 200 (register keeps 201).
- Reason: The columns implement exactly the prompt's UNVERIFIED-storage, ban-window and last-login requirements (B1.7 will flip the verified stamps). The body-refresh escape hatch keeps the API usable for server-to-server clients that have no cookie jar, without weakening the browser path (Set-Cookie only).
- Alternatives: a separate devices table (deferred until push targets need it), refresh-token-in-body for browsers (XSS exfiltration risk — rejected).

## 2026-11-01 — B1.4 OTP: HMAC-at-rest, randomInt codes, BullMQ 6 job scheduler

- Prompt: B1.4
- Decision: One-time codes are numeric via `crypto.randomInt(0, 10**length)` (uniform, no modulo bias) with leading-zero padding, stored ONLY as HMAC-SHA256(`<otpId>:<code>`) keyed by the new `OTP_HMAC_SECRET` env (≥ 32 chars). Verification normalizes Persian digits, increments `attempts` atomically (SQL `attempts + 1`) and compares with `timingSafeEqual` behind a spy-able `compareCode()` method. Caps live in Redis (fail-open): 1/60 s per target+purpose (INCR + EXPIRE NX cooldown), 5/h per target, 20/h per ip. The maintenance job `otp:cleanup` runs on the `maintenance` queue every 10 min through a new `WorkersService.registerRepeatable()` that uses BullMQ 6's `upsertJobScheduler` (the legacy `repeat` option was removed from `JobsOptions` in BullMQ 6 — scheduler ids dedupe across restarts).
- Reason: The id-in-HMAC construction makes hashes non-comparable across rows (no shared salt problem) while keeping the plain code out of the database. INCR+EXPIRE NX reuses the platform's proven Redis pattern without extending the RedisLike interface. `upsertJobScheduler` is the BullMQ-6-native idempotent way to keep a repeatable schedule alive across worker restarts.
- Alternatives: storing bcrypt/argon2 hashes of codes (per-row KDF cost pointless for 6 digits — HMAC with a server secret is the standard OTP-at-rest pattern), cron library (extra dependency), SETNX-based cooldown (FakeRedis/set semantics diverged — replaced with the limiter's INCR pattern).

## 2026-11-01 — B1.5 SMS providers: Melipayamak + Kavenegar REST contracts

- Prompt: B1.5
- Decision: SMS goes through `SmsDriver` with three implementations — `fake` (default; Redis outbox `dev:sms:outbox`, LPUSH + LTRIM 50), `melipayamak` and `kavenegar` — selected at SEND time from `sms.provider` (registry enum, default `fake`). No new dependencies: Node 22 built-in `fetch` with `AbortSignal.timeout(8000)`.
  - Melipayamak (docs read 2026-11-01: provider's own REST sample https://github.com/Melipayamak/melipayamak-python/blob/master/melipayamak/sms/rest.py and https://www.melipayamak.com/api/ doc pages): `POST https://rest.payamak-panel.com/api/SendSMS/SendSMS` (form-urlencoded: username, password, to, from, text, isFlash) and OTP via `POST .../SendSMS/BaseServiceNumber` (username, password, to, bodyId, text = tokens joined with `;`). Envelope `{ Value, RetStatus, StrRetStatus }` — success iff `StrRetStatus === 'Ok'`; anything else is NON-retryable with providerCode = RetStatus.
  - Kavenegar (docs read 2026-11-01: https://kavenegar.com/rest.html and the official kavenegar-node README): `POST https://api.kavenegar.com/v1/{API-KEY}/sms/send.json` (receptor, message, sender) and OTP via `.../verify/lookup.json` (receptor, token, template). Envelope `{ return: { status, message }, entries: [{ messageid }] }` — success iff `return.status === 200`; HTTP 409 ("server busy — try later") is the only provider-level RETRYABLE code; 4xx (400/401/402/403/418 insufficient credit/…) are non-retryable; HTTP 5xx and network/timeout failures are retryable.
  - Retry semantics in the queue: attempts 4, exponential backoff 10 s; non-retryable failures are rethrown as BullMQ `UnrecoverableError` so the worker skips remaining attempts.
  - OTP jobs: `removeOnComplete: true`, `removeOnFail: { age: 3600 }` — the code never outlives delivery in Redis.
  - RBAC: the admin test endpoint is the first `@RequirePermissions()` consumer — RolesGuard now enforces permission metadata via a static ROLE_PERMISSIONS map (admin: `settings.manage`, super_admin: `*`); no per-user overrides yet.
- Reason: Both providers are the dominant Iranian SMS gateways with stable, undocumented-in-OpenAPI REST surfaces; following their exact parameter names/response envelopes (verified against the providers' own sample code) avoids surprises. Form-urlencoded was chosen over JSON because both endpoints documented it. Retryability is explicit per error, because retrying a 418 "insufficient credit" would only multiply cost.
- Alternatives: SDK packages (@kavenegar/node, melipayamak npm — unmaintained, extra surface), SOAP Melipayamak API (legacy), SMS.ir (different customer base). Alternatives rejected: retrying on every failure (burns credit and delays OTP), storing provider responses (delivery reports are out of scope per the prompt).
- Assumptions: The Melipayamak sample repo and Kavenegar's doc page were readable, but NO live account was available — both drivers MUST be verified with real credentials before production (recorded in PROGRESS Follow-ups). Kavenegar `verify/lookup.json` path was confirmed via the official Node client sample (kavenegar-node README) while the main doc page only partially rendered today.

## 2026-11-01 — B1.6 nodemailer 10.3.1 and SMTP error classification

- Prompt: B1.6
- Decision: nodemailer 10.3.1 (runtime), @types/nodemailer 8.0.2 (dev) — exact pins, versions read from the npm registry; SMTP transport options (host/port/secure/pool/auth/tls.rejectUnauthorized) and `verify()` semantics confirmed against nodemailer.com/smtp. Classification: `responseCode` 4xx → retryable, 5xx → permanent; transport codes ECONNECTION/ECONNREFUSED/ECONNRESET/ESOCKET/ETIMEDOUT/EDNS → retryable; EAUTH/EENVELOPE/EMESSAGE and unknown → permanent.
- Reason: nodemailer is the de-facto Node SMTP library and pools connections (one TCP stream for bursts of transactional mail). The mapping mirrors SMTP semantics (4xx temporary, 5xx permanent) instead of guessing from error strings.
- Alternatives: bare `net`+TLS hand-rolled SMTP (no), email HTTP APIs (none reachable from an Iranian host without VPN for the major providers).
- Assumptions: @types/nodemailer 8.x matches nodemailer 10.x (types track the 8.0 line of DefinitelyTyped for nodemailer 10 — verified by successful typecheck of all used APIs).

## 2026-11-01 — B1.6 settings-over-env resolution and null-means-unset

- Prompt: B1.6
- Decision: Effective SMTP config = `email.smtp.*` / `email.from.*` setting when set, else `SMTP_*` env (registered in env.ts with Mailpit defaults). "Unset" in the registry is represented as `''` for strings and `null` for port/secure (nullable schemas) — not sentinel numbers.
- Reason: The prompt requires settings-if-set-otherwise-env; a boolean cannot use '' and a port 0 sentinel is a lie the schema would have to allow. Null schemas make admin "clear this override" unambiguous.
- Alternatives: separate `email.smtp.overrides` object (harder per-key masking in listings), env-only config (prompt requires panel-managed values).

## 2026-11-01 — B1.6 health-indicator aggregation (HealthModule.withIndicators) + postgres gap fix

- Prompt: B1.6 (wiring), B0.2 (postgres indicator requirement)
- Decision: `HealthModule.withIndicators(...classes)` aggregates indicator instances into the HEALTH_INDICATORS array token via a factory; AppModule uses `HealthModule.withIndicators(PostgresHealthIndicator, SmtpHealthIndicator)`. The `postgres` critical indicator (B0.2's spec: `select 1`, 2 s timeout) was missing from the committed B0.2 chain and is added here alongside the new non-critical `smtp` indicator (verify() cached 60 s in the driver). EmailModule is @Global (like RedisModule/DrizzleModule) so the SMTP_DRIVER token is visible to the HealthModule context.
- Reason: Nest never merges providers sharing a token across modules, so aggregation must happen in exactly one factory. Email is cross-cutting (auth verification in B1.7, notifications in B5.x), which justifies global visibility. Fixing the B0.2 gap while touching the exact wiring avoids leaving a known prompt requirement open indefinitely.
- Alternatives: registering indicators inside their owning modules with a collector service (more moving parts), leaving postgres out and adding a Follow-up (the health contract in B0.2's Done-when explicitly names it).

## 2026-11-01 — B1.6 inline fa/en templates until B5.3, one escape point

- Prompt: B1.6
- Decision: Five templates (otp, verify-email, reset-password, welcome, generic) live as code with inline fa/en text; `renderEmail(id, locale, vars, fallbackLocale)` resolves fa/en or falls back to the site locale then `en`. Variables are escaped exactly once in the template builders via the shared `escapeHtml`; the shared layout receives pre-escaped strings and escapes only its own brand constants.
- Reason: The i18n module (B1.12) and translatable notification templates (B5.3) do not exist yet — the prompt explicitly scopes inline templates. Double-escaping was caught by tests (title passed through layout twice) and fixed by the single-escape-point contract.
- Alternatives: translation keys now (i18n seed files are for UI chrome, not rich mail bodies), a mail-merge library (unnecessary for five templates).

## 2026-11-01 — B1.7 OTP auth flows: contracts reuse, takeover rule, reset channel resolution

- Prompt: B1.7
- Decision: The six request bodies live in contracts/auth.ts; `otpChannelSchema`, `otpRequestResultSchema` and `OtpPurpose` are REUSED from contracts/otp.ts (B1.4 already anticipated these flows) instead of being re-defined. New repository primitive `UsersRepositoryLike.attachIdentifier` performs attach + verify-stamp + conflict/takeover in ONE transaction. Login-OTP for an existing unverified target logs into THAT user and flips the stamp; password-reset codes are always verified against the row's PREFERRED verified channel (email first, then phone), which is also where forgot delivered them. Registration usernames are `u` + 8 lowercase base36 chars from crypto.randomInt with collision retry (5×).
- Reason: Keeps a single source of truth for shared wire shapes (TS2308 duplicate-export errors caught the first attempt). The transactional attach makes the takeover rule race-free; verifying the reset code against the delivery channel makes purpose/target mismatch impossible to exploit. crypto.randomInt over Math.random: usernames are low-value but consistency with the OTP generator avoids review noise in Q12.1.
- Alternatives: separate `verify_code` purpose per channel (more states, no benefit), letting any held identifier be verified at login (would allow hijacking a verified address another account already proved — rejected).

## 2026-11-01 — B1.7 HTTP-level queue simulation in tests (InlineQueuesService)

- Prompt: B1.7
- Decision: auth.otp.spec.ts overrides `QUEUES_SERVICE` with an inline double whose `enqueue()` immediately runs the REAL module processor (`SmsService.deliver` / `EmailService.deliver`), giving the HTTP tests the full enqueue → deliver → fake-driver path with no Redis. Each test builds its own app (fresh FakeRedis) because the OtpService per-IP hourly cap (20) is shared state that a 16-test suite would exhaust.
- Reason: The real QueuesService opens a BullMQ ioredis connection on first enqueue — in this sandbox that means an endless retry loop against 127.0.0.1:6379 (the suite hung until this override). Inline delivery preserves the code path the worker runs; retry/backoff semantics stay covered by the unit specs and the Docker follow-up.
- Alternatives: mocking SmsService/EmailService entirely (would bypass deliver + templates), running a real Redis (unavailable), one shared app with raised caps (product constants must not change for tests).

## 2026-11-01 — B1.8 Google OAuth: server-side OIDC with PKCE, disabled by default

- Prompt: B1.8
- Decision: Authorization-code flow with PKCE (S256) entirely server-side. jose 6.2.14 (already pinned by B1.3) provides SignJWT/jwtVerify/createRemoteJWKSet — no new dependency. Google endpoints (authorization `accounts.google.com/o/oauth2/v2/auth`, token `oauth2.googleapis.com/token`, JWKS `www.googleapis.com/oauth2/v3/certs`, issuer `https://accounts.google.com`); JWKS cached 1 h (jose v6 `cacheMaxAge`; the v5-style `cache` boolean no longer exists). The state cookie is an HS256 JWT signed with the existing `JWT_REFRESH_SECRET` (issuer/audience-scoped, 5 min) — no new secret. The JWKS handle is injected via the `GOOGLE_OIDC_JWKS` token so tests bind a locally generated RS256 keypair and mock `fetch` for the token endpoint; the suite runs with zero network.
- Reason: the prompt names jose for ID token verification; reusing it avoids a second JWT stack. Sealing state as a JWT reuses an existing secret and gives expiry/tamper detection for free. Injectable JWKS keeps tests deterministic per AGENTS.md §10.
- Alternatives: a dedicated OAUTH_STATE_SECRET env (rejected: another secret to rotate for no security gain — the payload is stateless and short-lived), google-auth-library (heavy, pulls gRPC; jose already covers verification), verifying via the tokeninfo endpoint (extra network hop, deprecated pattern).
- Assumptions/limits: real end-to-end login cannot be verified without real Google credentials (and Google is commonly unreachable from Iranian servers — the reason the feature ships disabled and 404s until an admin enables it). Settings keys `oauth.google.enabled/clientId/clientSecret` were NOT registered by B1.1 as the prompt assumed — B1.8 registered them itself (see PROGRESS Follow-ups).

## 2026-11-01 — B1.9 image stack: sharp 0.35.5, file-type 22.3.0 (ESM via dynamic import), multer 2.5.0

- Prompt: B1.9
- Decision: Pinned sharp 0.35.5, file-type 22.3.0, multer 2.5.0 (+ @types/multer 2.3.0 dev) in apps/api. Images are processed as `sharp(buffer, { autoOrient: true, limitInputPixels: MAX_IMAGE_PIXELS })` → `.resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })` → `.webp({ quality: 82 })`, thumbnail `.resize(400, 400, { fit: 'inside', withoutEnlargement: true })` q75. `autoOrient: true` replaces the prompt's `.rotate()` form — the current sharp docs (v0.35 constructor API) expose EXIF orientation handling as the constructor option `autoOrient`; the output is identical (orientation applied, tag not needed). Metadata stripping is sharp's documented DEFAULT ("The default behaviour, when withMetadata is not used, is to strip all metadata") — no withMetadata call exists anywhere in the pipeline.
- Reason: exact-pinned current stables per AGENTS.md 2 (npm registry, 2026-11-01): sharp 0.35.5 (ESM+CJS builds), file-type 22.3.0, multer 2.5.0 (post-2.2.0 security line, `@nestjs/platform-express` 12.3.2 compatible).
- Alternatives: file-type 16.5.4 (last CJS line, 2022 — rejected, not current and missing modern formats' checks); imagemin/jimp (slower, weaker format support); streaming through busboy manually (reimplementing multer).
- Notes/assumptions:
  - file-type 22 is ESM-only while @app/api is CJS: the media service uses `await import('file-type')` (true dynamic import). On the runtime Node line this resolves through require(esm) (unflagged since Node 22.12) or native dynamic import; vitest executes it natively. TypeScript needs a one-file ambient shim `apps/api/src/types/file-type.d.ts` because the api tsconfig chain uses `moduleResolution: "Node"` which cannot read exports-only type maps — remove the shim when the chain moves to node16/nodenext/bundler.
  - Serving route placement: `GET /media/<key>` must live OUTSIDE `/api/v1` while upload/delete stay inside. `setGlobalPrefix('api/v1', { exclude })` therefore excludes only GET `media/{*splat}` routes (path-to-regexp v8 named wildcard) — a string-based exclude would strip the prefix from POST/DELETE too.
  - Multipart field order is unreliable, so "check kind before buffering" is approximated as documented in the prompt: multer caps at the largest per-kind limit (15 MB), MediaService enforces the exact per-kind cap (413) right after parsing. Nest maps multer `LIMIT_FILE_SIZE` to 413 natively.
  - Disk driver writes are atomic (temp file + rename in the same directory), keys are re-validated on EVERY driver call, and the media serving route computes a stable ETag from key+size (keys embed a fresh uuid, so content is immutable).

## 2026-11-01 — B1.9 storage keys use UTC <yyyy>/<mm> partitions

- Prompt: B1.9
- Decision: media keys are `<kind>/<yyyy>/<mm>/<uuid>.webp` with the date taken from UTC at upload time.
- Reason: the prompt specifies `<kind>/<yyyy>/<mm>/<uuid>` but no timezone; UTC keeps keys deterministic regardless of the server timezone (AGENTS.md: timestamps are stored in UTC), and the uuid makes collisions impossible.
- Alternatives: Asia/Tehran partitions (align buckets with business-local time but make keys depend on host TZ settings), flat uuid-only keys (no sharding-friendly layout).

## 2026-11-01 — B1.10 profile endpoints live in the auth module (route stays /users/me)

- Prompt: B1.10 (said "user module")
- Decision: `ProfileService` + `ProfileController` live in `modules/auth/` while mounting `/api/v1/users/me*`.
- Reason: every profile flow touches sessions, password hashes, the login throttle and linked OAuth identities — all auth-module state. UsersModule cannot import AuthModule (AuthModule already imports UsersModule → DI cycle). AuthModule importing the (global) media services and UsersModule exports is one-directional and cycle-free.
- Alternatives: forwardRef between the two modules (banned by AGENTS.md "no circular imports"), duplicating session/password logic in users (two sources of truth for security flows).

## 2026-11-01 — B1.10 fullName maps to displayName; wire status gains 'deleted'

- Prompt: B1.10
- Decision: the profile contract uses `displayName` (matching the B1.2 column and B1.3 auth contract) instead of introducing a second `fullName` field; `USER_STATUSES`/`user_status` enum gains `'deleted'` so the wire type matches the database after the soft delete.
- Reason: one field name across register (B1.3 already accepted `fullName` — mapped onto the same column), schema and admin view avoids a migration rename and a duplicated concept. Deleted users never authenticate, so the widened status never leaks into `currentUserSchema` in practice.
- Alternatives: renaming the column to full_name (touches B1.2/B1.3 code), keeping the wire enum at active|blocked (cast gymnastics at the mapper).

## 2026-11-01 — B1.10 shared CurrentUser mapper

- Prompt: B1.10
- Decision: one `toCurrentUser(row, avatarUrl?)` mapper in users module consumed by AuthService, AuthOtpService and ProfileService; `currentUserSchema` gains bio/avatarUrl/hasPassword/updatedAt.
- Reason: three builders had already drifted; the schema `.parse()` at the boundary guarantees the wire shape stays contract-true.
- Alternatives: keeping per-service builders (drift), resolving avatarUrl inside the mapper (would need a DB call in a pure function).

## 2026-11-01 — B1.11 settingKeySchema admits mixed case; settings audit uses SECRET_MASK

- Prompt: B1.11
- Decision: `settingKeySchema` now accepts `[A-Za-z0-9]` segments (the B1.1 registry already contains `sms.kavenegar.apiKey`, which the old lowercase-only regex rejected — such keys could never be updated through the API). Settings audit rows record secrets with the project SECRET_MASK + `changed: true` instead of the audit-redactor's `[redacted]` marker.
- Reason: the wire contract must admit every registered key; the mask keeps the admin UI vocabulary consistent while never exposing plaintext (enforced by a table-scan test).
- Alternatives: renaming the registry key (touches B1.1-owned data and stored rows), leaving the mismatch (broken endpoint for a registered key).

## 2026-11-01 — B1.11 audit event ownership and login-failure sampling

- Prompt: B1.11
- Decision: audit rows for auth/settings actions are written ONLY by AuthAuditSubscriber (@OnEvent listeners); services emit, audit persists. `settings.set/reset` gained an optional actor parameter fed by the controller (never guessed). Failed logins are sampled at most 1 per identifier-hash per minute, keyed by userId when known else ip+reason (the B1.3 event payload carries no raw identifier — by design).
- Reason: single write path per action (no doubles), and the request path never waits on audit IO. `auth.session.revoked` carries no userId in its payload (session-scoped), so those rows have a null actor and the sessionId as entityId.
- Alternatives: writing audit inline in each service (duplicated, couples modules to audit), passing raw identifiers into events (PII in event payloads).

## 2026-11-01 — B1.12 i18n storage model: flat dot keys, no HTML, insert-if-absent seeds

- Prompt: B1.12
- Decision: Translations are flat dot-key strings (PK (locale, key)) instead of jsonb per-locale documents. Seed files are nested JSON flattened at load; seeders are `always`-mode but insert-if-absent (`ON CONFLICT DO NOTHING`), so admin edits are never overwritten. Values are plain text: control characters stripped, HTML tags rejected with 422 (ICU-style `{var}` placeholders allowed).
- Reason: Dot keys make namespace filtering, missing-key diffs and version hashing trivial; jsonb documents would need jsonb-path indexing for the same operations and hide per-key audit. Insert-if-absent matches the product reality: seed content is a BASELINE, the database is the source of truth after an admin touches it. No HTML keeps the render path safe without a sanitizer dependency (AGENTS.md: user-facing text is never trusted markup).
- Alternatives: jsonb per-locale (heavier diffs, no per-key updated_by), overwriting seeds on every reseed (destroys admin edits), allowing a sanitized HTML subset (needs a sanitizer dependency for zero current consumers).
- Assumptions: none.

## 2026-11-01 — B1.12 bundle cache: per-locale Redis revision counter instead of key scans

- Prompt: B1.12
- Decision: Every translation write INCRs `i18n:rev:<locale>`; bundle caches are keyed by that revision (`i18n:raw:<locale>:v<N>`, `i18n:composed:<locale>:v<N>:d<D>`) with a 10-minute TTL. Nothing is scanned or deleted on write; old entries expire.
- Reason: CacheService deliberately has no delByPrefix (SCAN-based invalidation was rejected in B0.3 for latency); a revision in the key gives instant, exact invalidation for both the written locale AND every locale that composes fallback from it (the default-locale revision is part of dependent bundle keys). Redis-down degrades to loader-per-request (cache fails open, B0.3 rule).
- Alternatives: deleting all bundle keys per write (SCAN cost + racy), versioning bundles from a DB row (extra round trip per request).
- Assumptions: none.

## 2026-11-01 — B1.12 LocaleValidator moved to I18nModule (async, DB-backed)

- Prompt: B1.12
- Decision: The B1.10 static `{fa, en}` LocaleValidator is replaced by a DB-backed one in the i18n module (validates against ACTIVE languages, cached 60 s; region variants map to base codes). `normalize()` became async and the single call site (profile update) was updated. I18nModule is @Global so UsersModule/AuthModule need no import changes.
- Reason: The languages table is the new source of truth; a static allow-list would drift the moment an admin adds `ar`. Keeping the `normalize(locale): string | null` contract (now a Promise) preserved the profile endpoint's semantics.
- Alternatives: keeping the provider in UsersModule with an injected i18n repo (couples users to i18n internals), sync validator with a preloaded set (stale after language changes).
- Assumptions: none.

## 2026-11-01 — B1.13 theme tokens live once in contracts; DB stores admin state

- Prompt: B1.13
- Decision: The three builtin packs' token values exist ONLY in `packages/contracts/src/theme/packs.ts` (transcribed from docs/DESIGN.md sections 2-4 and pinned by ratio tests against the section-5 table, tolerance < 0.005). The `theme_packs` table is seeded insert-if-absent; `resetToDefault` re-reads the contracts values. The active pack id is the `theme.activePackId` setting (group `theme`, public) so F2.4 settings UI and the theme endpoint share one source.
- Reason: DESIGN.md section 1 mandates tokens defined once; duplicating them in a seeder would let the two copies drift. Insert-if-absent seeding keeps admin edits authoritative while making shipped values restorable without a migration.
- Alternatives: storing seed values in the DB and treating it as canonical (reset needs a backup table), compiling DESIGN.md into CSS at build time (no admin switching without deploy).
- Assumptions: none — the seed ratios were verified against the DESIGN.md contrast table by test (all three packs, both modes).

## 2026-11-01 — B1.13 contrast validation at the API boundary, not the DB

- Prompt: B1.13
- Decision: `PUT /admin/theme/packs/:id` runs `validatePackContrast` (WCAG relative luminance, the exact pair list and 4.5/3.0 thresholds of DESIGN.md section 5) BEFORE persisting; failures return 422 with `details.failedPairs: [{ mode, pair, ratio, min }]`. The DB itself stores jsonb tokens without constraints.
- Reason: Contrast math (pow/log) is not reasonably expressible as a CHECK constraint; the API is the only writer (service-validated, B1.13 admin-only), so boundary validation is sufficient and gives editors actionable failure details.
- Alternatives: DB trigger validating jsonb (undiscoverable errors, hard to test), accepting and flagging invalid packs (ships broken themes).
- Assumptions: none.

## 2026-11-01 — B1.14 hierarchy rules in the service; admin controller lives in AuthModule

- Prompt: B1.14
- Decision: Role/ban hierarchy (self-target, rank table user<owner<moderator<admin<super_admin, users.assign_admin = super_admin only, target-active rule, last super_admin protection) is enforced in UsersService — the controller only audits. The UsersAdminController lives in the AUTH module (like ProfileService, B1.10) because ban/role-change must revoke sessions SYNCHRONOUSLY through SessionService and UsersModule cannot import AuthModule without a DI cycle.
- Reason: Service-level enforcement keeps the invariants true for every future caller (CLI, jobs), not just HTTP. Synchronous revocation closes the "banned user keeps a live token" window entirely; an event-driven revoke would be eventual.
- Alternatives: controller-only checks (bypassable), cross-module repository import (AGENTS.md 6 forbids), forwardRef module cycle (fragile).
- Assumptions: none.

## 2026-11-01 — B1.14 expired bans are "not banned" in code; the job is durable cleanup

- Prompt: B1.14
- Decision: `UsersService.effectiveStatus(row)` maps `blocked` + past `banned_until` to `active`; login, refresh and the JwtAuthGuard status cache all compare through it. The guard's 30 s `auth:userstatus:<id>` cache stores the EFFECTIVE status, and admin mutations + the `users:expire-bans` job (maintenance queue, every 5 min) invalidate it per user.
- Reason: The prompt requires an expired ban to stop blocking immediately; a job-only design would keep users locked for up to 5 minutes past expiry. With effectiveStatus the recovery is instant everywhere, and the job remains the bookkeeping that restores the row.
- Alternatives: job-only unban (5-min lockout tail), TTL-0 status cache (extra DB hit per request), triggers on banned_until (hidden logic).
- Assumptions: none.

## 2026-11-01 — B1.14 shared maintenance-queue dispatcher

- Prompt: B1.14
- Decision: WorkersService keeps its one-processor-per-queue rule; a dispatcher (`src/queue/maintenance.jobs.ts`, registered once from AppModule) owns the `maintenance` processor and routes job names to handlers registered by domain modules (`registerMaintenanceHandler` / `scheduleMaintenanceJob`). otp:cleanup (B1.7) was migrated to the dispatcher.
- Reason: B1.14 needed a second repeatable on `maintenance` and the one-processor rule (B0.4) forbids a second register; a name-routing dispatcher scales to future housekeeping jobs without weakening the "exactly one consumer per queue" invariant. The handler map is module-level and REPLACES on re-register because test suites boot the AppModule repeatedly in one worker process.
- Alternatives: a dedicated `users` queue (strays from the B0.4 queue plan), removing the one-processor rule (loses the clear consumer-per-queue contract).
- Assumptions: none.

## 2026-11-01 — I1.1 env consolidation: schema-first with a drift guard

- Prompt: I1.1
- Decision: `SETTINGS_ENCRYPTION_KEY` moved INTO the zod env schema (optional, default '') and SettingsService reads it via AppConfig instead of process.env (AGENTS.md: no direct process.env in app code). `check:env` compares `.env.example` keys against a deterministic regex extraction of the schema's top-level keys (importing the TS file from .mjs is not possible under the CJS package scope); web build-time keys (`NEXT_PUBLIC_API_URL`) are an explicit allow-list. `check:secrets` scans `git ls-files` for private-key headers, `sk-`/AKIA tokens and 32-hex secret assignments, exempting `.env.example`, lockfiles and `// fake-secret` lines. Both run in `pnpm verify` and CI. `env:init` fills ONLY empty/placeholder secret values (48-byte base64url for JWT/OTP secrets, 32-byte base64 for the settings key) and prints key names, never values.
- Reason: The example file and the schema are two representations of one contract; the guard turns drift into a CI failure. Line-wise parsing (`split('\n')` + key-shape check) replaced a `matchAll` regex after the sandbox toolchain showed inconsistent multiline-`^` behavior — same semantics, no engine dependency.
- Alternatives: joi/envalid (zod already pinned), importing compiled dist in the checker (build-order coupling), vault integration (out of scope per prompt).
- Assumptions: none.

## 2026-11-01 — I1.1 settings-key rotation is transactional and test-anchored

- Prompt: I1.1
- Decision: `rotate-settings-key.ts` re-encrypts every `is_secret` settings row with the NEW key inside one transaction (`SELECT … FOR UPDATE`), skipping non-envelope values; a wrong OLD key throws and rolls back EVERYTHING. The CLI wrapper (`rotate-settings-key.cli.ts`) walks up to `.env.example` for the repo root, loads `.env`, and refuses NEW == OLD / short keys.
- Reason: A half-rotated settings table is unrecoverable by design (the old key is gone), so atomicity is the only safe shape. The integration test (settings.rotation.spec.ts) pins both the success path (values readable with NEW, unreadable with OLD, plain rows untouched) and the rollback path.
- Alternatives: decrypt-in-app-on-read with dual keys (complex envelope versioning for one migration), offline export/import (manual error-prone).
- Assumptions: none.

## 2026-11-01 — F1.1 frontend i18n: dynamic languages, API bundles, formatting

- Prompt: F1.1
- Decision:
  - `date-fns-jalali` pinned at `4.4.0-0` (current stable line, 2026-05-31) for Jalali calendar formatting and the `fromIsoToJalaliParts`/`toIsoDateFromJalali` picker pair; Gregorian locales and relative/compact formatting use `Intl`.
  - Routing: `src/i18n/routing.ts` stays the build-safe STATIC pair (`fa`,`en`, `localePrefix: 'as-needed'`, `localeDetection: false`) for next-intl's plugin/typing/prerender; the proxy (`src/proxy.ts`, Next 16 Node-runtime middleware) rebuilds the next-intl handler per request from the ACTIVE language list (`GET /i18n/languages`) and the default locale (`GET /settings/public` → `site.locale`; the prompt's `site.defaultLocale` maps to the registry key `site.locale` registered in B1.1). Unknown/inactive locales are not blocked in the proxy — the `[locale]` layout validates against the same list and renders the localized 404. Language list cached 60 s in memory (shared RSC+proxy) with a 5 s negative cache on API failure; fetch timeouts are 3 s.
  - The visitor's choice persists in a NON-httpOnly cookie `locale` (1 year, Lax, Secure in production): it is a non-sensitive preference the switcher writes client-side (`useSwitchLocale`), deliberately exempted from the session-cookie httpOnly rule (AGENTS.md 9 applies to session cookies).
  - Messages: the API serves FLAT dot-key bundles; next-intl v4 resolves keys through a NESTED tree (verified against use-intl 4.14.9 — flat bundles make every `t()` fall back to the key path), so `bundle-loader.ts` merges the default-locale bundle under the requested one on the flat level and re-nests with `expandMessages` before returning from `getRequestConfig`. Bundled seed copies live in `apps/web/src/i18n/fallback/` (byte-identical copies of the API seeds, guarded by a drift test) and are re-synced by `scripts/sync-i18n-fallback.mjs` chained into the web `build` script. Revalidation is time-based only (no revalidate route handler).
  - Formatting: `createFormatters(locale)` factory in `src/lib/format.ts` — next-intl exposes the active locale only inside React context, so helpers take the locale explicitly through the factory and stay pure/testable. Persian digits via `toPersianDigits` (date-fns-jalali emits Latin digits even for fa); Jalali wall-time in a target time zone uses the offset-compensation trick (date-fns-jalali has no `timeZone` option and no `TZDate` export; DST circularity is irrelevant — Iran has no DST since 2022). `formatMoneyIrr` divides Rials by 10 with display-only rounding; the unit comes from `common.currency.toman` at call sites, with a non-React per-locale fallback constant (`fa` → «تومان») documented here.
- Reason: Keeps one source of truth for languages (the API) while the build stays hermetic; the smoke test caught the flat→nested requirement (h1 rendered the key's last segment) before any commit.
- Alternatives: `@date-fns/tz` TZDate (extra dependency for one call site), proxy-level 404 for unknown locales (loses the styled localized 404), `NEXT_LOCALE` cookie default (the prompt mandates `locale`), auto-`Accept-Language` detection (forbidden by the prompt).
- Assumptions: Week-info via `Intl.Locale.getWeekInfo` with a static map fallback (fa→Saturday); ICU joins compact units with U+00A0 (pinned in tests).

## 2026-11-02 — F1.2 dynamic theme engine: inline CSS vars, no-flash, /dev/ui matrix

- Prompt: F1.2
- Decision:
  - `tokensToCss(tokens)` (`src/lib/theme/tokens-to-css.ts`) is a pure, deterministic (sorted) converter from a validated `ThemeTokens` to CSS text: `--tok-<kebab>` per color for `:root,[data-mode='light']` and `[data-mode='dark']`, plus `--radius-*`, `--control-h`, `--card-p`, `--heading-weight`, `--latin-heading-ls`, `--shadow-*` (+`-dark` variants), and `--card-style`/`--header-style`/`--density` custom properties. Values are defensively escaped (`<\/` → the only sequence that can close a `<style>`) even though validated tokens never contain it — `dangerouslySetInnerHTML` is permitted ONLY here per AGENTS.md.
  - The static `--tok-*` values were REMOVED from `globals.css`; only the `@theme` semantic mapping (`bg-bg` → `var(--tok-bg)`, ...) and the non-pack base rules (focus ring, RTL line-height, `color-scheme`, `[data-card]` styles) remain. The inline `<style id="theme-vars">` block generated from the active pack supplies the runtime values, so switching pack/mode swaps values with no re-render.
  - `getActiveTheme()` (`src/lib/theme/server.ts`) fetches `GET /theme` (B1.13) with `next.revalidate:60` + a 60 s in-memory cache and a 5 s negative cache; on any failure it returns the bundled `modern` pack (`defaultThemePacks[0]`) so the site renders with NO external dependency (AGENTS.md 2). ETag/304 is handled by the platform fetch cache.
  - No-flash mode: cookie `mode` ∈ {light,dark,system}. The server renders `data-mode=light` for light/system (and `data-mode-pref`), then a tiny STATIC inline script in `<head>` (`SYSTEM_MODE_INLINE_SCRIPT`) flips `data-mode` to dark from `prefers-color-scheme: dark` before first paint ONLY when pref=system, and subscribes to OS changes. For explicit light/dark the server already set the correct value. CSP nonce approach deferred to Q12.2 per the prompt.
  - `useThemeMode({pref,resolved})` writes the cookie (1y, Lax, path=/) and updates `<html data-mode>`/`data-mode-pref` immediately; in system mode it follows OS changes. `useActiveTheme()` reads the pack id from a server-rendered `ActiveThemeProvider` (no extra client request).
  - `/dev/ui` (dev-only, 404 in production via `NODE_ENV` check) renders a pack preview matrix: toolbar for the three packs × {light,dark,system}, swatches of every token, type scale, radii and shadows. `?pack=&mode=` override the active pack CLIENT-SIDE only on this route by rewriting `#theme-vars` and the `<html data-*>` attributes.
  - `generateMetadata`/`generateViewport` replaced the static `metadata`/`viewport` exports (Next 16 forbids both) and set `theme-color` from the active pack's light `bg`.
- Reason: A single inline style block (vs many `<style>` per component or a CSS-in-JS runtime) keeps the bundle free of external requests and lets the admin pack switch propagate to every visitor within the 60 s revalidate window with no flash. The 7-test Playwright spec (`theme-no-flash.spec.ts`) asserts the server HTML attributes and the computed background for light/dark/system and the three packs.
- Alternatives: next-themes (extra dependency + its own script tag pattern); static per-pack CSS files (loses admin edit-then-reflect within 60 s); CSS-in-JS (runtime cost, external-free rule violation risk).
- Assumptions: Playwright chromium installed via `pnpm exec playwright install chromium` (the cached v1200 did not match the pinned playwright 1.64.1 → v1248 was downloaded). The API `/theme` endpoint is built by B1.13; while it is down the bundled fallback (modern) is used and asserted by the e2e spec.

## 2026-11-02 — F1.3 base UI Kit (semantic tokens, Radix, cva, RTL-aware)

- Prompt: F1.3
- Decision:
  - Deps pinned (exact, recorded here per AGENTS.md): `@radix-ui/react-slot@1.5.0`, `@radix-ui/react-avatar@1.3.1`, `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.7.0` (runtime); `@testing-library/react@16.3.3`, `@testing-library/user-event@14.6.8`, `@testing-library/jest-dom@7.0.1`, `jest-axe@11.0.0`, `jsdom@30.1.3` (dev). All latest stable at write time (npm registry API).
  - `cn` (src/lib/cn.ts) is the single clsx+tailwind-merge combiner; every component imports it so the physical-class ban (check:rtl) is enforced at one chokepoint.
  - Components in src/components/ui, exported from index.ts: Button (variants primary/secondary/ghost/danger/link; sizes via --control-h; loading keeps width + spinner + aria-busy + click-block; asChild via Radix Slot; icon-only requires aria-label enforced by TS overloads), IconButton (square, mandatory aria-label), Spinner, Card family (look from [data-card] attribute via components.css reading runtime tokens), Badge (surfaceAlt bg + status text + optional icon, never color alone), Avatar/AvatarGroup (Radix Avatar + Persian-aware initials: ZWNJ treated as space so «علی‌رضا احمدی» → «عر»), Separator, Skeleton (text/circle/rect; shimmer honors prefers-reduced-motion), EmptyState, ErrorState (from ApiRequestError or string, retry button, request id in muted small), Rating (display: 0–5 half stars, Persian digits, aria-label via ui.rating.label ICU; input: radiogroup of 10 half-step radios, arrow keys RTL-aware — ArrowLeft increases in RTL, ArrowRight increases in LTR — Home/End, hover preview), Tag/Chip (selectable/removable/plain), ProgressBar, Kbd, Heading, Text, VisuallyHidden, icons barrel + DirIcon (rtl:-scale-x-100 flip).
  - components.css (src/styles) holds the pack-driven [data-card] rules (moved out of globals.css), the reduced-motion skeleton shimmer and the rating half-star clip; globals.css imports it.
  - vitest config: two envs — node default for .spec.ts, jsdom via per-file `// @vitest-environment jsdom` pragma for test/components/.test.ts(x); SWC automatic jsx-runtime so test files need no `import React`; setup.ts adds jest-dom matchers + ResizeObserver/matchMedia shims. jest-axe types declared in types/jest-axe.d.ts (the package ships none).
  - Translation keys added to both web fallback and api seed: ui.{loading,retry,close,error,requestId,rating.{label,inputLabel,star}} (ICU placeholders {value}/{max}/{id}).
  - /dev/ui rewritten: toolbar (pack × mode) + DevUiShowcase rendering every component in all variants/states.
- Reason: One cn chokepoint + semantic-token-only classes keep the pack/mode swap from F1.2 working with no per-component CSS; TS overloads make a missing icon-only aria-label a compile error, not an a11y bug found in review. Rating arrow-key direction follows the visual flow (RTL mirrors LTR) so keyboard and mouse agree.
- Tests: 112 web tests green (incl. 26 new component tests: avatar initials incl. ZWNJ, button loading blocks click, rating arrow keys in both dirs + Home/End, badge/empty/error axe + content); pnpm verify 16/16; e2e no-flash 7/7.
- Alternatives: headless-ui instead of Radix (Radix Slot/Avatar are smaller and peer with cva); styled-components (runtime + external-free rule risk); own Avatar initials without ZWNJ handling (wrong initials for common Persian compound names).
- Assumptions: jest-axe runs in jsdom (no layout, so color-contrast rules are best-effort — the e2e axe spec on the real rendered page is the authoritative contrast check, deferred to per-page specs).

## 2026-11-02 — F1.4 form UI Kit (react-hook-form + Zod resolver, RTL phones, OTP)

- Prompt: F1.4
- Decision:
  - Deps pinned (exact, latest stable at write time via npm registry): `react-hook-form@7.91.0`, `@hookform/resolvers@7.0.1` (zodResolver), reusing `zod@3.24.1`.
  - `useApiMutation` (src/lib/api/use-api-mutation.ts) — the F0.2 contract: wraps TanStack `useMutation` with retry policy (never retry 4xx, retry 5xx once) and exposes `isClientError` / `isRateLimited` / `fieldErrors(error)`. `fieldErrors` reads `ApiRequestError.details.fields` (shape `{ fields: Record<name, FieldIssue[]> }` where `FieldIssue` is a translation-key string or `{ key, params }`); returns `{}` for non-field errors so form code calls it unconditionally.
  - `useZodForm(schema, options)` (src/components/ui/form/use-zod-form.ts) — `useForm` with `zodResolver`, `mode: 'onBlur'`, `reValidateMode: 'onChange'`. Exposes `setServerErrors(fieldErrors)` that stamps each server issue via `setError({type:'server'})` and focuses the first invalid field through `data-field-name` (controls are tagged with it by `Field`). Zod schemas carry translation KEYS in `message` (`validation.*`), not literal strings.
  - `translateIssue(t, issue)` (src/lib/forms/translate-issue.ts) — resolves a Zod issue / server FieldIssue to a localized string via a root-scoped next-intl translator; falls back to the raw key on unknown/parametric-missing errors so a missing translation is visible, not silent. Parametric interpolation is verbatim (digit Persianization happens at the display layer — PhoneInput/Textarea counter — not in the translator).
  - digits.ts: `toAsciiDigits` (Persian+Arabic-Indic → ASCII), `toPersianDigits`, `toDisplayDigits(value, locale)`. phone.ts: `normalizeIranianPhone` → E.164 (handles `09…`, `۰۹…`, `+98…`, `0098…`, `98…`, bare `9…`), `toIranianNationalDisplay` → `0912 345 6789`.
  - Components (src/components/ui/form, exported through the ui barrel): Field (label/hint/error/required marker «(الزامی)» via `form.required`, aria-describedby wiring, error announced via `role=alert` + `aria-live=polite`, tags control with `data-field-name`), Label, Input (text/email/password w/ show-hide toggle button accessible name + `aria-pressed`; search w/ leading icon; dir prop; start/end adornments with logical ps-/pe- padding), PhoneInput (E.164 on change+blur, national display with Persian digits in fa, always `dir=ltr`, accepts pasted Persian digits), OtpInput (N cells, auto-advance, backspace clears previous, full-code paste, `autocomplete=one-time-code` + `inputmode=numeric`, Persian digits → ASCII, always LTR cell order, live-region error, `onComplete`), PasswordInput (strength meter 0–4 from length+variety only, visible text label not color alone), Textarea (auto-grow via scrollHeight, localized char counter with Persian digits, maxLength), Select (native styled for mobile), Checkbox, RadioGroup (fieldset/legend), Switch (role=switch, hidden native input as sibling not child so axe nested-interactive passes), FormError (form-level summary with focus-targeting links), SubmitButton (type=submit, loading from isSubmitting), FileDropzone (single/multiple, accept, size-limit message, image thumbnails + remove, keyboard accessible, hands File[] to caller — no upload), CopyField (read-only + clipboard button with "Copied" feedback).
  - Translation keys added to both web fallback AND api seed (kept byte-identical, asserted by i18n-fallback-sync.spec): `validation.{required,email,phone,min,max,password,username,match}` and the `form.*` namespace (required marker, password show/hide + strength labels, characterCount, otp label/desc, fileDropzone strings, copy strings, errorSummary title/link, playground labels).
  - /dev/ui: added a FormPlayground card (valid form wired through useZodForm, inject-server-error button → setServerErrors, disabled + readonly variants, PhoneInput/OtpInput/PasswordInput/Textarea/Select/Checkbox/RadioGroup/Switch/FileDropzone/CopyField all live).
- Reason: Translation keys (not literals) in Zod messages keep validation locale-agnostic; the `data-field-name` tag lets `setServerErrors` focus the first invalid field without RHF refs threading. PhoneInput always-LTR + E.164 internal value means schemas and the API never see Persian digits or local formats. OtpInput's hidden `autocomplete=one-time-code` input lets SMS autofill fill all cells; the per-cell inputs handle the visible UX. Switch/FileDropzone hide their native input as a SIBLING of the visible control (not a child) so axe's nested-interactive / no-focusable-content rules pass.
- Tests: 188 web tests green (76 new in test/forms: digits table, phone E.164 table incl. the exact prompt triple `0912 345 6789`/`۰۹۱۲۳۴۵۶۷۸۹`/`+98 912 345 6789`, OTP paste+backspace+RTL+auto-advance+onComplete, password strength levels, Field aria wiring, useZodForm server-error stamping + first-invalid focus, translateIssue every key in both locales incl. parametric, useApiMutation fieldErrors derivation, axe on every component); pnpm --filter @app/web test/lint/typecheck green; check:rtl OK (50 files). e2e: 11/12 pass — the 1 failure (home.spec `negotiates en`) is pre-existing on HEAD/F1.3 (locale routing), unrelated to F1.4.
- Alternatives: TanStack Form instead of react-hook-form (RHF is smaller, the Zod resolver is first-party, and the `setServerErrors` pattern is well-trodden); a custom OTP without a hidden one-time-code input (loses SMS autofill); color-only strength meter (fails color-blind + high-contrast).
- Assumptions: react-hook-form docs read from the official site (resolver integration, `useForm` options); could not fetch live so versions pinned from the npm registry API and the API shape verified against the installed 7.91.0. The `details.fields` envelope shape is the F0.2 contract; the actual API endpoint is built later (B-track), so `useApiMutation` is exercised against a synthetic `ApiRequestError` in tests.

## 2026-11-04 — F1.5 overlay + data UI Kit (Radix Dialog/Popover/Tabs/Tooltip/Toast/Accordion)

- Prompt: F1.5
- Decision:
  - Deps pinned (exact, latest stable at write time via npm registry): `@radix-ui/react-dialog@1.3.1`, `@radix-ui/react-popover@1.3.1`, `@radix-ui/react-dropdown-menu@2.2.1`, `@radix-ui/react-tabs@1.2.1`, `@radix-ui/react-tooltip@1.4.1`, `@radix-ui/react-toast@1.3.1`, `@radix-ui/react-accordion@1.3.1`.
  - Overlays (src/components/ui): `Modal` (Radix Dialog — focus trap/ESC/overlay-click/focus-return free; sizes sm/md/lg; under 768px becomes a bottom sheet with drag handle + safe-area padding; `dismissible={false}` blocks ESC + overlay click), `Drawer` (side panel from logical `end` edge — right in LTR, left in RTL — via `inset-inline-end-0`/`slide-in-from-end`; `side="start"` for the opposite edge), `BottomSheet` (snap points collapsed/half/full; pointer drag on the handle + keyboard chevron buttons + ArrowUp/Down so it works without pointer events), `ConfirmDialog` (controlled) + `useConfirm()` promise hook (destructive variant, loading state during async `onConfirm`, queues pending confirms).
  - Popovers: `Popover`, `DropdownMenu` (item/separator/checkbox-item/destructive/sub/label; Radix arrow-key nav is RTL-aware), `Tooltip` (shown on hover AND keyboard focus via Radix; never the only place for essential info — `Provider` bundled so callers don't wrap), `Tabs` (lazy panels, `aria-selected`, arrow keys follow visual direction in RTL via Radix; horizontal/vertical), `Accordion` (multiple/single, chevron rotates on open).
  - Toasts: `ToastProvider` + `useToast()` with `success`/`error`/`info`/`promise`. Placement: inline-end bottom on desktop, top center on mobile (per DESIGN.md). 5s auto-dismiss, pauses on hover/focus (Radix). `role="alert"` for errors, `role="status"` for success/info. Max 3 visible (older dropped). Action button support. `promise` shows loading→success/error.
  - Data: `DataTable<T>` (columns config: header/cell/sortable; `aria-sort` on sortable `<th>`; click cycles none→asc→desc→none; sticky header; row selection via header + row checkboxes; loading skeleton rows; empty/error slots; under 768px renders `renderMobileCard` cards instead of the table), `Pagination` (Persian digits in `fa`; prev/next icons follow reading direction via `rtl:hidden` LTR/RTL variant pair; `aria-current="page"`; ellipsis on jumps; "page X of Y" translated; single-page edge case shows a note), `Breadcrumbs` (logical-separator chevron `rtl:-scale-x-100`; last item `aria-current="page"`; optional schema.org `BreadcrumbList` JSON-LD), `Stat` (label/value/delta with arrow icon + text label — never color alone; Persian digits), `Timeline` (vertical, dot per item on the start edge, tone colors), `CopyButton` (icon-only or full button; "Copied" feedback for 2s; `aria-pressed`).
  - Translation keys (overlay/confirm/toast/table/pagination/stat/copy from the F1.5 prep commit + `form.playground.*` overlay/data playground labels added here) synced to both web fallback AND api seed (byte-identical, asserted by i18n-fallback-sync.spec).
  - /dev/ui: added `OverlayPlayground` (wrapped in `ToastProvider` at the showcase root) — every overlay has a trigger, a Modal opens inside a Drawer (verifies nested focus handling), toast buttons (success/error/promise), Tabs, Accordion, DataTable with selection + mobile cards, Pagination, Breadcrumbs, Stat, Timeline, CopyButton.
- Reason: Radix gives focus trap, ESC, scroll-lock, focus return and RTL arrow-key mirroring for free — re-implementing would be a liability. Logical positioning (`inset-inline-end`, `slide-in-from-end`, `text-start`) means a single code path works in both `dir` values. Pagination renders two prev/next buttons (LTR + RTL variant) toggled by `rtl:hidden` so the icon always points the right way without runtime JS.
- Tests: 229 web tests green (41 new in test/overlays: Modal focus-trap/ESC/dismissible=false/aria + axe, Tabs aria-selected/arrow-keys/click/axe, DropdownMenu open/arrow-down/select/checkbox/axe, Toast fire/role=status+alert/auto-dismiss with fake timers/max-3-visible, DataTable empty/loading/error/sort-aria-sort/selection/mobile-card, Pagination single-page/prev-disabled/aria-current/click/ellipsis/Persian-digits, overlay+data axe on each closed/open state). pnpm --filter @app/web test/lint/typecheck green; build green; check:rtl OK (71 files, fixed a `text-left`→`text-start` in PhoneInput and tagged 3 prose comments `// rtl-ok`).
- Alternatives: Sonner for toasts (extra dep, less control over placement/locale digits); a custom modal without Radix (re-implementing focus trap is error-prone); CSS-only tabs (loses arrow-key RTL handling); color-only Stat delta (fails color-blind/high-contrast).
- Assumptions: Radix RTL behavior verified against the installed 1.3.x docs (Radix mirrors `side`/`align` and swaps arrow keys when `dir` is set on an ancestor). The BottomSheet pointer-drag is thresholded (40px) so a small drag doesn't snap across two points; a big drag-down past `collapsed` closes the sheet. Toast `promise` resolves/rejects with the underlying promise's value/error.

## 2026-11-04 — F1.6 Jalali calendar + Persian number input

- Prompt: F1.6
- Decision:
  - `date-fns-jalali@4.4.0-0` was already a dependency (pinned in F1.5 prep). No new package added. Verified API: `newDate(jy, jm0, jd)`, `getYear/getMonth/getDate/getDay`, `getDaysInMonth`, `addMonths`, `isSameDay`, `format`, `parse`. Confirmed Farvardin 1 1405 = Saturday = 2026-03-21, Esfand 1403 = 30 days (leap).
  - Calendar engine (`src/lib/calendar/calendar-system.ts`): a `CalendarSystem` interface (`getMonthGrid`, `getMonthName`, `getWeekdayNames`, `fromDate`, `toDate`, `addMonths`, `isSameDay`, `isWeekend`, `format`, `parse`) with two implementations — `jalali` (locale `fa`) and `gregorian` (others). **Canonical store is always a JS `Date` or ISO `YYYY-MM-DD` (Gregorian)**; conversion to/from Jalali happens only inside the engine. Month grids always render 6 rows × 7 cols (42 cells) for stable height. Week start: Saturday (6) for Jalali, Monday (1) for Gregorian. `normalizeDigitsToAscii` helper converts Persian/Arabic-Indic digits to ASCII before `date-fns-jalali` parse (which only accepts ASCII). Weekend = Friday for Jalali, Sat/Sun for Gregorian.
  - Components (`src/components/ui/date/`):
    - `CalendarGrid` — shared WAI-ARIA `grid`/`gridcell` month view. Keyboard: arrows move by day, PageUp/Down by month, Home/End to week bounds, Enter/Space selects, ESC closes (at the picker level). **RTL arrow rule: arrows follow VISUAL direction** — in an RTL grid ArrowRight moves to the PREVIOUS day and ArrowLeft to the NEXT day; detected at runtime via `document.documentElement.dir === 'rtl'`. Selected day has a non-color cue (ring + bold weight) in addition to `aria-selected`.
    - `DatePicker` — typed input + calendar popover. Typed text parsed in the active calendar; accepts Persian/Arabic/ASCII digits with `/` or `-` separators. Desktop: Radix Popover; **mobile (<768px via matchMedia): Radix Dialog bottom sheet**. `min`/`max`/`disabledDates` enforced (aria-disabled on cells). Clearable. The trigger button is shared (single onClick) and both Root components are controlled by the same `open` state — no `Dialog.Trigger asChild` wrapper span (which would put `aria-expanded` on a roleless element and fail axe).
    - `DateRangePicker` — two linked DatePickers: start's max = current end, end's min = current start. Composes the single-date picker rather than re-implementing a calendar, so it inherits all keyboard + RTL behavior.
    - `TimePicker` — typeable 24-hour `HH:mm`. Accepts `:`/`.`/space separators + Persian/Arabic/ASCII digits. `step` snaps minutes. ArrowUp/Down move by `step`. Always `dir="ltr"` + `text-start` (numbers are LTR even in RTL pages).
    - `DateTimePicker` — composes DatePicker + TimePicker; value is one ISO `YYYY-MM-DDTHH:mm` string.
    - `MonthYearJumper` — prev/next year steppers + a 12-button month grid in the display calendar's language.
    - `NumberInput` — accepts Persian (۰-۹), Arabic (٠-٩) and ASCII digits + thousands separators while typing; parses to a `number | null` on blur; formats with locale thousands separators (and the Toman unit when `currency`). `min`/`max`/`step` (ArrowUp/Down). Always `dir="ltr"` + `text-start`.
  - i18n keys `form.number.*` and `form.date.*` (placeholder, prevMonth/nextMonth, today, clear, selectDate, selected, disabledDate, weekdaysNarrow, invalid, outOfRange, apply/cancel, startDate/endDate, year/month, jumpToMonth, hour/minute/second, time) + `form.playground.dateTitle` synced to web fallback AND api seed (byte-identical, asserted by i18n-fallback-sync).
  - /dev/ui: `DatePlayground` added to the showcase — every component in the active locale, with the current ISO value printed so you can verify by hand that typing `1405/01/01` yields `2026-03-21`.
- Reason: date-fns-jalali is already pinned and gives correct Jalali arithmetic; the engine abstraction means a single component code path serves both calendars (only the system impl swaps). Keeping ISO Gregorian as the canonical store means the API/database never sees Jalali parts — conversion is purely a display concern. The RTL arrow rule (arrows follow visual direction) is the WAI-ARIA recommendation and matches user expectation in a mirrored grid.
- Tests: 277 web tests green (30 new in test/calendar: calendar-system 18 — grid gen for 29/30/31-day months, Esfand 1403 = 30 days, Farvardin 1405 weekday = Saturday, 200 random round-trips, parse `۱۴۰۵/۰۱/۰۱` → 2026-03-21, isWeekend, addMonths, weekday names; NumberInput 10 — Persian/Arabic/ASCII digit parsing, thousands-sep table (`۱٬۲۳۴٬۵۶۷` → 1234567), null, clamp, ArrowUp/Down, locale formatting, currency unit, dir=ltr; DatePicker 9 — parse ASCII/Persian/Gregorian, formatted display fa/en, popover open, aria-selected, min enforcement, clear; TimePicker 6 — parse, Persian digits, step snap, ArrowUp, invalid rejection, dir=ltr; axe 5 — each component clean closed). pnpm test/lint/typecheck green; build green; check:rtl OK (88 files — tagged F1.5 physical `side` enum values + modal positioning with `// rtl-ok`).
- Alternatives: react-day-picker (heavy, Jalali support is community plugins); a custom calendar without date-fns-jalali (re-implementing leap-year math is error-prone); storing Jalali ISO strings in the DB (would force every locale-switch to re-convert, and the API would need locale awareness — rejected).
- Assumptions: `date-fns-jalali` `parse` only accepts ASCII digits, so we normalize before parsing (documented + tested). The BottomSheet in DatePicker reuses the CalendarGrid (no separate snap points needed for a single-date pick). DateRangePicker uses two single pickers rather than a two-click-on-one-grid interaction — simpler, fully accessible, and the visual range highlight is deferred to F6.1 (reservation slot picker) where it's actually needed.

## 2026-11-04 — F1.7 Application shell (header, footer, mobile nav, route groups, auth state)

- Prompt: F1.7
- Decision:
  - **Auth state** (`src/lib/auth/auth-context.tsx`): `useAuth()` → `{ user, status: 'loading'|'authenticated'|'anonymous', apiError, refresh(), logout() }`. The INITIAL user is resolved on the SERVER (root `(public)` layout calls `resolveAuthServer()` → `GET /auth/me` with forwarded cookies; 401 = anonymous, any other failure = anonymous + `apiError:true`) and passed to `AuthProvider` as `initialUser` so there is no first-paint flicker. React Query keeps it fresh under `qk.auth.me()`. The provider listens for the `auth:expired` window event (dispatched by the API client on a 401 — added to `api/client.ts` here since F0.2 hadn't wired it yet) and flips the cache to anonymous immediately. `logout()` POSTs `/auth/logout` then clears the cache.
  - **Layout components** (`src/components/layout/`): `Container`, `Section`, `PageHeader` (title/description/actions/breadcrumbs with a RTL-flipping chevron), `HeroHeaderMarker` (opts a page into the transparent header by setting `data-header="transparent"` on `<html>` on mount, restoring `'solid'` on unmount — default solid so the luxe pack works on pages without a hero), `SiteHeader` (brand mark + name from `BRAND` linking to `/`, primary nav from `NAV_ITEMS` config — role-filtered, `aria-current` on the active link, search entry link, `LanguageSwitcher`, `ThemeModeToggle`, `UserMenu`; sticky; header style follows the `data-header` attribute via `data-[header=…]` variants), `SiteFooter` (brand + tagline, link columns from `FOOTER_COLUMNS`, a repeat of the language switcher on mobile, copyright with the year formatted in the active calendar via `formatDate` — `fa` → Jalali year), `MobileNav` (bottom tab bar for xs/sm, ~4 nav items + account, hides on scroll-down / shows on scroll-up with `prefers-reduced-motion` respected — reduced-motion users keep the bar visible, safe-area padding).
  - **Controls**: `LanguageSwitcher` (dropdown of active languages via `useLanguages`, native names, current marked with a check, `useSwitchLocale` writes the `locale` cookie + navigates), `ThemeModeToggle` (light/dark/system with icons + labels, `useThemeMode` writes the `mode` cookie + updates `data-mode`/`data-mode-pref`; renders a disabled placeholder until mounted to avoid hydration mismatch since the server-rendered attributes already applied the correct mode via the inline script), `UserMenu` (anonymous → login/register buttons; authenticated → avatar dropdown with Profile/Sessions, Dashboard link for owner/admin/super_admin, Admin link for moderator/admin/super_admin, Logout; navigation via the next-intl router inside `onSelect` so Radix closes the menu on click).
  - **nav.config.ts**: `NAV_ITEMS` array `{ key, href, labelKey, icon, visibleFor?, mobile? }` so later prompts only add an entry. `ACCOUNT_NAV_ITEM` and `FOOTER_COLUMNS` similarly config-driven.
  - **Route groups** under `src/app/[locale]/`: `(public)` (header + footer + mobile nav, wrapped in `AuthProvider`), `(auth)` (centered card layout, minimal header with brand + back link, no footer/mobile nav), `(account)` (header + desktop sidebar / mobile tab-scroller, requires login), `(dashboard)` (guard: owner|admin|super_admin, otherwise 403), `(admin)` (guard: moderator|admin|super_admin, otherwise 403; shell built by F2.1). The home page moved into `(public)`.
  - **Guard helper** (`src/lib/auth/guard.ts`): a PURE `decideAccess({ user, roles, pathname })` → `allow | login | forbidden` (unit-tested without Next.js), plus `requireUser({ roles, pathname })` that resolves auth server-side, redirects anonymous to `/login?next=<path>`, and returns `forbidden` for wrong-role so the layout renders the 403 page in place.
  - **Error/loading pages**: global `error.tsx` (client, `ErrorState` + retry + back-home), `loading.tsx` (spinner skeleton), `not-found.tsx` (404 with `EmptyState`), and `Forbidden` (403 body reused by the dashboard/admin guards).
  - **i18n keys** `brand.*`, `nav.*`, `footer.*`, `layout.*`, `auth.menu.*`, `theme.mode.*`, `language.switcher.*` synced to web fallback AND api seed (byte-identical, asserted by i18n-fallback-sync).
  - **vitest.config.ts**: added a `resolve.alias` for `@/* → ./src/*` so component specs that import via `@/i18n/navigation` resolve at runtime (the tsconfig `paths` only covers typecheck/build, not vitest's runtime resolver).
- Reason: SSR-resolved auth removes the logged-out flicker that plagues client-only auth; the pure `decideAccess` keeps the guard logic testable; config-driven nav means future prompts add entries without touching the header; the transparent-on-hero marker keeps the luxe pack working everywhere by default.
- Tests: 299 web tests green (22 new in test/auth: guard 6 — anonymous→login, role match/mismatch, admin/moderator matrix; site-header 7 — anonymous login/register buttons, role-filtered nav for user/owner/admin, brand name in en+fa; controls 9 — language switcher lists native names + calls switchLocale, theme toggle writes the `mode` cookie + flips `data-mode`, footer copyright year, MobileNav hides/shows on scroll with a synchronous rAF stub + act(), axe on footer + mobile nav). pnpm test/lint/typecheck green; build green; check:rtl OK (98 files). The Playwright smoke across packs/locales is deferred to F1.9 (e2e harness) — the unit + axe coverage covers the shell behavior.
- Alternatives: client-only auth (flicker on every reload — rejected); a single root-level `AuthProvider` instead of per-group (the auth/account/dashboard shells each wrap their own provider so each is self-contained and the guards run server-side before the shell renders); a redirect for wrong-role instead of a 403 page (a redirect hides the reason — the prompt asked for a 403 page in place).
- Assumptions: `x-pathname` header is not yet set by middleware (F1.8 builds the middleware); until then `(account)`/`(dashboard)`/`(admin)` best-effort parse the `referer` for the `next` param. The `auth:expired` dispatch was added to `api/client.ts` (F0.2 hadn't wired it); F1.8 may refine it. The `ThemeModeToggle` reads `data-mode`/`data-mode-pref` from `<html>` on mount (server-rendered by the root layout) to avoid a hydration mismatch.

## 2026-11-04 — F1.8 auth pages, middleware session refresh, safe `next`

- Prompt: F1.8
- Decision:
  - **Middleware session refresh** lives in `src/proxy.ts` (the prompt's "middleware.ts" — Next.js 16 renamed it to the proxy convention; F1.1 already created `proxy.ts`, so the refresh composes with the existing locale handler instead of adding a second file). For a page request carrying the `rt` cookie but a missing/expired `at`, the proxy makes exactly ONE server-side `POST /api/v1/auth/refresh` forwarding the `rt` (plus an `Origin` header built from `request.nextUrl.origin` — the API's `CsrfOriginGuard` requires it for cookie-bearing unsafe requests, and page navigations carry no Origin). On success the API's raw `Set-Cookie` lines are (1) appended verbatim to the browser response (works for rendered and redirected responses alike) and (2) merged into the CURRENT request's `Cookie` header so server components (`GET /auth/me` in the layouts) see the fresh session in the same render. Failures (API down, 401, 403, timeout 3 s) change nothing — the visitor continues anonymous; no cookie is ever cleared here. No loop: the refresh call goes directly to the API origin and the matcher (`/((?!api|_next|_vercel|.*\..*).*)`) never matches API routes or static assets. `at` expiry is decided by parsing the JWT `exp` WITHOUT signature verification — safe because the API independently validates the `rt`; an unparseable `at` counts as expired. A 30 s leeway avoids rendering with a dying token. The same header pass stamps `x-pathname` (F1.7's layouts were written to consume it).
  - **Pure helpers** for the above live in `src/lib/auth/session-refresh.ts` (`needsSessionRefresh`, `accessTokenExpiry`, `parseSetCookiePair`, `mergeRequestCookies`) and are unit-tested without the Next.js runtime.
  - **Safe `next`**: `src/lib/auth/next-path.ts` — `safeNextPath()` accepts ONLY site-relative paths (must start with `/`, must not start with `//`, must not contain `\`, whitespace or control chars; length ≤ 512) and falls back to `/` otherwise. Applied to every consumer of `?next=` (login page, Google start link, LoginRequiredPrompt builds its own from `usePathname`).
  - **API hooks** in `src/lib/api/auth.ts` wrap `useApiMutation` + the B1.3/B1.7 contract schemas (`loginBodySchema`, `registerBodySchema`, `otpRequestBodySchema`, …). `useLogout` clears `qk.auth.me()` in `onSettled` so a failed call can never trap the visitor in a logged-in UI. `useOAuthProviders` reads the PUBLIC settings blob (`GET /settings/public`, key `oauth.google.enabled`) — B1.8 registered no dedicated providers endpoint. `forgotPasswordResultSchema` (`{ ok: true }`) was added to packages/contracts so the anti-enumeration response has a named contract.
  - **Pages** under `[locale]/(auth)`: login (password + OTP tabs, Google button when enabled, lockout/rate-limit countdowns), register (live username format hint; availability checked ONLY on submit; strength meter; optional none/email/phone contact; accept-terms checkbox linking `/p/terms` + `/p/privacy` as plain links — those pages are F10.6's), forgot-password (generic confirmation screen), reset-password (identifier prefilled from query, else sessionStorage), verify (guarded by `requireUser`, channel choice disables channels whose identifier is absent from the account). The shared `OtpFlow` (send → code step with `resendAfterSec` countdown, auto-submit on complete, `OTP_*` error mapping) serves both login and verify. `VerificationBanner` is mounted in the `(account)` layout inside `AccountShell` (it reads `useAuth`). `LoginRequiredPrompt` (Modal + `?next=<current>`) ships for later features. A `ToastProvider` was added to the `(auth)` layout so auth flows can toast (reset-password success).
  - **i18n**: all copy through `auth.*` keys added to BOTH api seeds and synced to the web fallback (byte-identical, asserted by the existing sync test); numbers in countdowns go through `formatNumber` (Persian digits in fa).
  - **Tests**: the repo has no MSW, so component specs stub global `fetch` with a small route-matching router (same pattern as test/api-client.spec.ts). `vi.mock('@/i18n/navigation', …)` must be HOISTED per test file (vitest only hoists vi.mock in test files; next-intl's navigation pulls `next/navigation`, which pnpm strict isolation cannot resolve in vitest). `@playwright/test` spec `e2e/auth-pages.spec.ts` written (register→logout→login, SMS OTP via `GET /api/v1/dev/sms-outbox`) but NOT run in this sandbox — it self-skips without `DEV_TOOLS=true` and needs `PUBLIC_WEB_URL` to match the web origin (playwright uses port 3100) for the CSRF origin check.
- Reason: server-side refresh closes the "session dies between two navigations" gap without any client round-trip; keeping it in the proxy (not a `middleware.ts` twin) avoids two competing middlewares; the fail-open posture matches the platform-wide limiter policy (an API outage must not brick browsing).
- Tests: 385 web tests green (86 new in test/auth: next-path 22 incl. the prompt's redirect table (`/account`, `//evil.com`, `https://evil.com`, `/\evil`, `javascript:alert(1)`); session-refresh 15; login-form 12 — validation, INVALID_CREDENTIALS/ACCOUNT_BANNED/RATE_LIMITED/ACCOUNT_LOCKED mapping with fake-timer countdown and disabled submit, safe-next table via router mock, Google button conditional; otp-flow 6 — target validation, resend countdown arming/expiry, auto-submit, OTP_INVALID/OTP_EXPIRED/OTP_RESEND_TOO_SOON; register 6 — live hint, terms gate, success + nudge banner + payload assert, CONFLICT mapping, legal links; forgot-reset 5 — generic screen, identifier carry (query + sessionStorage), reset success toast + redirect, missing-identifier note; auth-hooks 5 — useOAuthProviders true/false, useLogout cache clear on failure, VerificationBanner visibility matrix; axe 15 — every auth surface × fa RTL + en LTR). pnpm lint/typecheck green; check:rtl/check:no-external OK.
- Alternatives: decoding/validating the access JWT signature in the proxy (needs the secret in the web runtime — rejected); clearing cookies on refresh failure (the prompt forbids it — a flaky API must not log people out); a dedicated `GET /auth/oauth/providers` endpoint (nothing exists in B1.8 to call — public settings already exposes the flag); MSW for component tests (new dependency for marginal gain over the existing fetch-stub pattern).
- Assumptions: the CSRF guard accepts the request-origin `Origin` header in the default dev topology (web :3000 ↔ `PUBLIC_WEB_URL=http://localhost:3000`) and in production (same public origin); on nonstandard ports (e2e's 3100) the refresh fails open until `PUBLIC_WEB_URL` matches. The OtpInput always renders 6 cells (API default `otp.length=6`); a changed setting would need the length passed through.
