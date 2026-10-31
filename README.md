# X-Brand-Pro

> پلتفرم کشف و بررسی کسب‌وکارهای محلی ایران — فارسی‌محور، RTL، چندزبانه و چندشهری.
>
> A local-business discovery and review platform for Iran: Persian-first, RTL, multi-language, multi-city. Built only with free/open-source services, deployable on an Iranian host (Runflare or a VPS) **without VPN, without CDN, and without any external runtime dependency.**

The product name is defined in exactly one place — `packages/config/src/brand.ts` — and enforced by `scripts/check-brand.mjs`. Do not write the name anywhere else.

---

## Status

This repository is **work in progress**, built phase-by-phase from the [prompt pack](https://github.com/amirhmohammadi3/X-Brand-Pro) (176 small prompts across 13 phases, 0→12). Progress is tracked in [`docs/PROGRESS.md`](./docs/PROGRESS.md) and the phase state machine in `scripts/orchestrator.mjs`.

**Current phase:** 0 — skeleton & infrastructure ✅ **completed** (13/13 prompts). Next: phase 1 (settings, auth, i18n, theme engine, UI Kit). See [`docs/PROGRESS.md`](./docs/PROGRESS.md) for the prompt-by-prompt tracker.

| Area                                                                                                                                            | State          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Monorepo (pnpm workspaces + Turborepo, shared TS/ESLint/Prettier, Husky hooks)                                                                  | ✅ done (P0.1) |
| Foundation files + brand.ts + guard scripts (`check:foundation`, `check:brand`)                                                                 | ✅ done (P0.2) |
| `packages/contracts` (Zod, response envelope, error codes, pagination, Persian text utils)                                                      | ✅ done (P0.3) |
| Dev Docker Compose (Postgres+PostGIS, Redis, Mailpit) + cross-platform `services.mjs`                                                           | ✅ done (I0.1) |
| NestJS skeleton (config, health, logging, error filter, OpenAPI)                                                                                | ✅ done (B0.1) |
| Drizzle ORM + migration runner + PostGIS extensions + test database                                                                             | ✅ done (B0.2) |
| Redis module (ioredis), JSON cache, Redis-backed rate limiter + global guard                                                                    | ✅ done (B0.3) |
| BullMQ queues + dedicated worker process + graceful shutdown                                                                                    | ✅ done (B0.4) |
| Next.js 16 skeleton (Tailwind 4 tokens, RTL, locale routing, self-hosted variable fonts)                                                        | ✅ done (F0.1) |
| Typed API client (contract-validated) + TanStack Query provider                                                                                 | ✅ done (F0.2) |
| Test infrastructure (Vitest, Supertest, Playwright + axe — 198 tests green)                                                                     | ✅ done (Q0.1) |
| GitHub Actions CI (verify chain + e2e job)                                                                                                      | ✅ done (I0.2) |
| Phase 0 gate                                                                                                                                    | ✅ done (Q0.2) |
| Phases 1–12 (auth, geography, search/map, reviews, messaging, reservations, owner dashboard, payments, AI, admin panel, video, security/deploy) | ⏳ queued      |

---

## What this project will be

A full local-business platform for Iran — think "Yelp + Google Maps + WhatsApp-for-business", but Persian-first and runnable on an Iranian host without any external dependency:

- **Multi-method auth** — username/password, SMS OTP, email OTP, Google OAuth
- **Geography** — cities, neighborhoods, categories managed by admin, PostGIS-powered
- **Business catalog** — full CRUD, owner self-registration, claim-ownership workflow
- **Search** — Persian full-text search (with ی/ک normalization, ZWNJ, Persian digits) + trigram + PostGIS radius
- **Map** — MapLibre GL with **self-hosted PMTiles** (Iran extract), no external tile requests
- **Reviews & trust** — verified check-in, reputation scores, anti-spam, owner replies, Q&A
- **Engagement** — bookmarks, follows, activity feed, notifications (in-app, email, SMS, web push), realtime messaging
- **Reservations** — capacity-aware slot engine, ICS calendar export, reminder + cancellation policy
- **Owner dashboard** — analytics (views, click funnel), business profile editor, review/reply management
- **Monetization** — paid subscriptions, targeted ads with budget/pacing, featured listings (Zarinpal sandbox)
- **AI features** — review summaries, FAQ auto-answers, personalized recommendations, toxicity scoring — through a pluggable driver (works without a token via a statistical base driver)
- **Admin panel** — users, businesses, moderation queue, translations, theme packs, integrations, audit log, feature flags, maintenance mode
- **Short videos** — ffmpeg pipeline, Reels-style feed
- **PWA** — installable, offline page, push notifications
- **i18n** — Persian (default, RTL) + English (LTR), admin can add more languages; every user-facing string is a translation key

Roles: `guest`, `user`, `owner` (business owner), `moderator`, `admin`, `super_admin`.

---

## Tech stack

Everything is decided in [`docs/DECISIONS.md`](./docs/DECISIONS.md) and pinned exactly (no `^`, no `~`, never `latest`). Versions are chosen by each prompt after reading current official docs.

| Layer                    | Choice                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo                 | pnpm workspaces + Turborepo                                                                                                        |
| Language                 | TypeScript (strict) everywhere                                                                                                     |
| Runtime                  | Node.js LTS (pinned in `.nvmrc`)                                                                                                   |
| Backend                  | NestJS (Express adapter) in `apps/api`                                                                                             |
| Validation               | Zod schemas from `packages/contracts` (shared by api and web)                                                                      |
| Database                 | PostgreSQL + PostGIS + pg_trgm + unaccent + pgcrypto                                                                               |
| ORM                      | Drizzle ORM + drizzle-kit migrations                                                                                               |
| Cache / queue / realtime | Redis + BullMQ                                                                                                                     |
| Frontend                 | Next.js (App Router) + React + Tailwind CSS in `apps/web`                                                                          |
| Data fetching            | TanStack Query                                                                                                                     |
| Forms                    | react-hook-form + Zod                                                                                                              |
| i18n                     | next-intl (messages come from the API)                                                                                             |
| Map                      | MapLibre GL with self-hosted PMTiles                                                                                               |
| Icons                    | lucide-react                                                                                                                       |
| Tests                    | Vitest (unit/integration), Supertest (API), Testing Library (components), Playwright + axe (e2e and accessibility)                 |
| Infra                    | Docker Compose (db, redis, mailpit for dev; api, web, worker, db, redis, nginx/caddy for prod)                                     |
| Fonts                    | self-hosted only (Vazirmatn for Persian/Arabic, Inter for Latin) via fontsource — **no Google Fonts, no CDN, no external scripts** |

External services (SMS, email, payment, storage, AI, geocoding) are always behind an interface with a `fake`/dev driver. The code must work end-to-end with only fake drivers. Real drivers (Melipayamak, Kavenegar, Zarinpal, AI tokens) are configured later from the admin panel.

---

## Repository layout

```text
.
├── AGENTS.md                  # project rules — READ FIRST in every session
├── README.md                  # this file
├── .github/workflows/ci.yml   # CI: verify chain + playwright e2e (I0.2)
├── docs/                      # living documentation (single source of truth)
│   ├── PROGRESS.md            # prompt-by-prompt progress tracker
│   ├── DECISIONS.md           # append-only log of every non-obvious choice
│   ├── DESIGN.md              # visual rules
│   ├── API.md                 # every endpoint (method, path, auth, schemas, errors, rate limits)
│   ├── DATA_MODEL.md          # every table (purpose, columns, indexes, constraints, owner module)
│   ├── SECURITY.md            # permissions matrix, rate limits, secrets inventory, threat notes
│   └── DEPLOYMENT.md          # env vars, deploy, runbook
├── packages/
│   ├── config/                # @app/config — shared tsconfig, ESLint preset, brand.ts
│   └── contracts/             # @app/contracts — zod schemas, envelope, errors, pagination, text utils
├── apps/
│   ├── api/                   # @app/api — NestJS HTTP app + worker entry (src/worker.ts)
│   │   ├── src/config/        # env schema (zod), config module
│   │   ├── src/db/            # drizzle client, migrate.ts (extensions + migrations), seed/
│   │   ├── src/redis/         # RedisService, CacheService, RateLimiterService
│   │   ├── src/queue/         # BullMQ QueuesService + WorkersService
│   │   ├── src/common/        # filters, guards (@RateLimit), decorators, pipes
│   │   ├── src/modules/health/    # health endpoint
│   │   ├── drizzle/           # migration journal + generated SQL (committed)
│   │   └── test/              # vitest suites, global-setup, db helpers, probe module
│   └── web/                   # @app/web — Next.js 16 (App Router, Turbopack)
│       ├── src/app/[locale]/  # locale-scoped root layout + pages
│       ├── src/i18n/          # routing (fa default unprefixed, /en) + request config
│       ├── src/lib/api/       # typed client (apiFetch/apiFetchServer), qk factory
│       ├── messages/          # fa/en seed messages (API-driven from F1.1)
│       ├── e2e/               # Playwright + axe specs
│       └── playwright.config.ts
├── infra/
│   ├── docker-compose.dev.yml # db (PostGIS 16-3.4-alpine), redis (7.4-alpine), mailpit (1.20)
│   └── db/init/               # 01-extensions.sql, 02-test-db.sql (auto-run on first boot)
├── scripts/                   # cross-platform Node (.mjs) scripts only — no bash/powershell
│   ├── orchestrator.mjs       # phase state machine + overlap guard (cron-driven)
│   ├── services.mjs           # up/down/reset/logs/status for dev Docker services
│   ├── dev.mjs                # pnpm dev → api watch + worker watch (+ web when present)
│   ├── check-foundation.mjs   # verifies AGENTS.md + 7 docs/ files are present, no duplicate prompt IDs
│   ├── check-brand.mjs        # fails if brand name appears outside the allow-list
│   ├── check-rtl.mjs          # bans physical-direction Tailwind classes (`rtl-ok` exempts)
│   ├── check-no-external.mjs  # bans third-party URLs in web source (`external-ok` exempts)
│   └── lib/                   # pure helpers + unit tests (Node test runner)
├── .env.example               # every env var with a fake example + comment
├── .nvmrc                     # Node LTS version
├── pnpm-workspace.yaml        # apps/*, packages/* + onlyBuiltDependencies (esbuild)
├── turbo.json                 # build/dev/lint/typecheck/test tasks
├── eslint.config.mjs          # root flat config, imports @app/config/eslint
├── .prettierrc.json
├── commitlint.config.mjs      # conventional commits, scopes free
└── .husky/                    # pre-commit (lint-staged), commit-msg (commitlint)
```

Package names: `@app/api`, `@app/web`, `@app/contracts`, `@app/config`.

---

## Prerequisites

- **Node.js LTS** — the exact version is pinned in [`.nvmrc`](./.nvmrc) (currently 22.11.0). Use [nvm](https://github.com/nvm-sh/nvm) / [fnm](https://github.com/Schniz/fnm) / [volta](https://volta.sh) to switch.
- **pnpm** — the exact version is pinned via `packageManager` in [`package.json`](./package.json) (currently 12.16.1). [Corepack](https://nodejs.org/api/corepack.html) will pick it up automatically (`corepack enable`).
- **Docker Desktop** (or Docker Engine + `docker compose` v2) — for the local Postgres + PostGIS + Redis + Mailpit services.
- **Git** with **Git Bash** on Windows (the Husky hooks are POSIX shell scripts).

---

## Quick start

```bash
# 1. Install dependencies (uses the frozen lockfile by default in CI; in dev just run install)
pnpm install

# 2. Start dev services (db, redis, mailpit) — requires Docker
pnpm services:up

# 3. (later prompts) apply migrations and seed
pnpm db:migrate
pnpm db:seed

# 4. Run api, worker and web in watch mode
pnpm dev
```

### Default ports

| Service       | Port | URL                                                  |
| ------------- | ---- | ---------------------------------------------------- |
| Web (Next.js) | 3000 | http://localhost:3000                                |
| API (NestJS)  | 4000 | http://localhost:4000/api/v1/health                  |
| Postgres      | 5432 | `postgres://app:app_dev_password@localhost:5432/app` |
| Redis         | 6379 | `redis://localhost:6379/0`                           |
| Mailpit SMTP  | 1025 | (used by the email driver in dev)                    |
| Mailpit UI    | 8025 | http://localhost:8025                                |
| Tile server   | 8080 | (added in phase 3)                                   |

All dev services bind to `127.0.0.1` only — they are not reachable from the LAN.

---

## Commands (root, all cross-platform)

| Command                        | What it does                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pnpm install`                 | install dependencies                                                                             |
| `pnpm services:up`             | start db, redis, mailpit (docker compose, waits for healthchecks)                                |
| `pnpm services:down`           | stop them (keeps data volumes)                                                                   |
| `pnpm services:reset`          | stop + **delete** data volumes + start again (destructive; asks for confirmation unless `--yes`) |
| `pnpm services:logs [service]` | tail logs (optional service name: `db` / `redis` / `mailpit`)                                    |
| `pnpm services:status`         | show container status                                                                            |
| `pnpm dev`                     | run api, worker and web in watch mode                                                            |
| `pnpm db:generate`             | generate a Drizzle migration from schema changes                                                 |
| `pnpm db:migrate`              | apply migrations                                                                                 |
| `pnpm db:seed`                 | run idempotent seeders                                                                           |
| `pnpm lint`                    | ESLint (via turbo)                                                                               |
| `pnpm typecheck`               | `tsc --noEmit` in every package (via turbo)                                                      |
| `pnpm test`                    | unit and integration tests (via turbo)                                                           |
| `pnpm test:e2e`                | Playwright                                                                                       |
| `pnpm test:scripts`            | unit tests for `scripts/lib/` (Node test runner)                                                 |
| `pnpm build`                   | production build of every package (via turbo)                                                    |
| `pnpm check:foundation`        | verify AGENTS.md + 7 docs/ files present, no duplicate prompt IDs                                |
| `pnpm check:brand`             | verify the brand name appears only in the allow-list                                             |
| `pnpm check:rtl`               | verify apps/web uses only logical-direction Tailwind utilities (`rtl-ok` exempts a line)         |
| `pnpm check:no-external`       | verify apps/web has no third-party URLs (`external-ok` exempts a line)                           |
| `pnpm verify`                  | all four guards + `lint` + `typecheck` + `test` + `build` (exactly what CI runs)                 |

---

## Documentation

The `docs/` folder is the **living source of truth** — code comments are "what" and "how", docs are "why" and "what's allowed".

| File                                         | Contents                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`AGENTS.md`](./AGENTS.md)                   | Project rules. **Read this first in every session.** Stack, layout, conventions, security, testing, git, scope rules. |
| [`docs/PROGRESS.md`](./docs/PROGRESS.md)     | Prompt-by-prompt progress tracker. Ticked after each prompt's "Done when" is verified.                                |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md)   | Append-only log of every non-obvious decision (library choice + version, architecture choice, trade-off, assumption). |
| [`docs/DESIGN.md`](./docs/DESIGN.md)         | Visual rules — the only source of truth for colors, typography, spacing, components.                                  |
| [`docs/API.md`](./docs/API.md)               | Every endpoint: method, path, auth, request/response schema names, error codes, rate limit.                           |
| [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md) | Every table: purpose, columns, indexes, constraints, owner module.                                                    |
| [`docs/SECURITY.md`](./docs/SECURITY.md)     | Permissions matrix, rate limits table, secrets inventory, threat notes.                                               |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Environment variables, deploy steps, runbook.                                                                         |

---

## Phase orchestration (cron-driven)

This repo is advanced phase-by-phase by an **hourly cron**. The state machine lives in [`scripts/orchestrator.mjs`](./scripts/orchestrator.mjs) and keeps its state in `.phase-state.json` (gitignored).

| Command                                         | Action                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `node scripts/orchestrator.mjs status`          | print current phase, lock, overlap-guard state                                          |
| `node scripts/orchestrator.mjs acquire`         | take the lock, mark the phase running, print the brief                                  |
| `node scripts/orchestrator.mjs log "P0.1 done"` | record a prompt as done                                                                 |
| `node scripts/orchestrator.mjs release --ok`    | release the lock, mark phase completed, advance to next phase                           |
| `node scripts/orchestrator.mjs release --fail`  | release the lock, mark phase failed (will retry next cron; `prompts_done` is preserved) |
| `node scripts/orchestrator.mjs next`            | advance to the next phase (only if current is completed)                                |

**Overlap guard:** `acquire` refuses to take the lock if a fresh lock exists (< 2 hours old, or pid still alive). A stale lock (> 2 hours, or pid no longer alive) is overridden. This prevents two cron-fired agents from working on the same phase simultaneously.

The 13 phases (0→12) are defined in [`scripts/orchestrator.mjs`](./scripts/orchestrator.mjs); the full plan with dependencies and phase gates is in [`00-START-HERE.md`](https://github.com/amirhmohammadi3/X-Brand-Pro) (in the prompt pack).

---

## Verification

```bash
# Full CI-equivalent check (lint + typecheck + test + build, plus the two guard scripts)
pnpm verify

# End-to-end tests (Playwright, chromium desktop + mobile, with axe accessibility checks)
pnpm test:e2e
```

`pnpm verify` is exactly what GitHub Actions CI runs (added in I0.2). Failures must be fixed at the root cause, never by weakening checks.

---

## Conventions (highlights — full rules in [`AGENTS.md`](./AGENTS.md))

- **Contract-first** — every request body, query, param and response shape is a Zod schema in `packages/contracts/src/<domain>.ts`. API and web share the same types; no duplication.
- **RTL & logical properties** — Tailwind classes use only logical properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`, `rounded-s`, `rounded-e`). Never `ml/mr/pl/pr/left/right`. `pnpm check:rtl` enforces this.
- **Digits** — store and transport ASCII. Persian/Arabic-Indic digits are normalized at the API edge. The UI shows Persian digits in `fa` locale via `formatNumber`.
- **Dates** — stored UTC (`timestamptz`). In `fa` show Jalali (`date-fns-jalali`); other locales Gregorian. Week starts Saturday in `fa`.
- **Persian text normalization** — Arabic `ي`→`ی`, `ك`→`ک`, remove tatweel and diacritics, unify ZWNJ. One shared implementation in `packages/contracts/src/text.ts`.
- **Money** — integer Rials (`bigint`, column suffix `_irr`). Never floating point. UI may display Toman (÷10) via `formatMoney`.
- **No external requests** from the browser — fonts, scripts, analytics, tiles, avatars all self-hosted. `pnpm check:no-external` enforces this.
- **No secrets in the repo** — only fake values in `.env.example`. Real secrets only in `.env` (gitignored) or encrypted settings.
- **Conventional commits** — `type(scope): summary` + footer `Prompt: <ID>`. `commitlint` enforces the type enum (`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`). One prompt = one or a few commits.
- **One prompt = one session** — start a fresh session for each prompt; the model reads `AGENTS.md` and `docs/PROGRESS.md` to get context, never relies on memory.

---

## License

Private. All rights reserved.
