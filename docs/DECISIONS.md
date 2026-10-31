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
