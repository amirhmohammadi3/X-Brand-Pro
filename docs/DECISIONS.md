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
