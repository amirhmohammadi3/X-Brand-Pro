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
