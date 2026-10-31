# X-Brand-Pro

A local-business discovery and review platform for Iran: Persian-first, RTL, multi-language, multi-city, deployable on an Iranian host without VPN, CDN or any external runtime dependency.

## Prerequisites

- Node.js LTS (the exact version is pinned in [`.nvmrc`](./.nvmrc))
- pnpm (the exact version is pinned via `packageManager` in [`package.json`](./package.json))
- Docker Desktop (for the local Postgres + PostGIS + Redis + Mailpit services)

## Quick start

```bash
pnpm install
pnpm services:up   # start db, redis, mailpit (requires Docker Desktop)
pnpm dev            # run api, worker and web in watch mode
```

- Web: http://localhost:3000
- API: http://localhost:4000/api/v1/health
- Mailpit UI: http://localhost:8025

## Where the docs are

- [`AGENTS.md`](./AGENTS.md) — project rules; **read this first in every session**.
- [`docs/PROGRESS.md`](./docs/PROGRESS.md) — prompt-by-prompt progress tracker.
- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — append-only log of every non-obvious decision.
- [`docs/DESIGN.md`](./docs/DESIGN.md) — visual rules (single source of truth).
- [`docs/API.md`](./docs/API.md), [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md), [`docs/SECURITY.md`](./docs/SECURITY.md), [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

The product name is defined in `packages/config/src/brand.ts` and enforced by `scripts/check-brand.mjs`.

## Verification

```bash
pnpm verify        # check:foundation + check:brand + lint + typecheck + test + build
pnpm test:e2e      # Playwright (chromium desktop + mobile)
```
