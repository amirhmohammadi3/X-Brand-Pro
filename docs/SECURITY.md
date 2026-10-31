# SECURITY

Every executing prompt that adds a permission, a rate limit, a secret, an upload, or a new trust boundary updates the matching section.

## 1. Permissions matrix

Format: one row per permission string, one column per role (`user`, `owner`, `moderator`, `admin`, `super_admin`) with `yes` or `no`, plus the endpoints that require it.

| Permission              | user | owner | moderator | admin | super_admin | Endpoints |
| ----------------------- | ---- | ----- | --------- | ----- | ----------- | --------- |
| (filled by prompt B1.2) |      |       |           |       |             |           |

## 2. Rate limits

Format: one row per limited endpoint group.

| Key                                                                   | Endpoint(s) | Limit | Window | Scope (ip, user, ip+identifier) | Prompt |
| --------------------------------------------------------------------- | ----------- | ----- | ------ | ------------------------------- | ------ |
| (per-endpoint rows are added by the prompts that own those endpoints) |             |       |        |                                 |        |

Mechanism (B0.3): fixed-window counter in Redis (`INCR` + `EXPIRE NX`, key `rl:<name>:<identity>:<epoch bucket>`), enforced by the global `RateLimitGuard` on routes annotated with `@RateLimit({ name, limit, windowSec, scope })`. Rejections are HTTP 429 with the `RATE_LIMITED` error envelope and a `Retry-After` header. Scope `ip` until the auth module lands; `user` falls back to ip for unauthenticated requests.

| Key               | Endpoint(s)          | Limit | Window | Scope | Prompt |
| ----------------- | -------------------- | ----- | ------ | ----- | ------ |
| `settings.public` | GET /settings/public | 60    | 60s    | ip    | B1.1   |

Failure mode: the limiter FAILS OPEN when Redis is unreachable (request allowed, warning logged, result marked `degraded`) so a cache-layer outage cannot take the API down. Acceptable risk: temporarily unlimited traffic during a Redis outage; mitigations (queueing, health alerting) are in the observability prompt Q12.10.

### Settings secrets (B1.1)

- Secret settings are encrypted at rest with AES-256-GCM (envelope `v1.iv.tag.ciphertext`, base64url parts); the key comes from `SETTINGS_ENCRYPTION_KEY` (>= 32 chars, scrypt-derived). Plaintext never reaches the database, the Redis cache, logs, or admin listings (fixed `••••••••` mask).
- Decrypt failures (tampered value or rotated key) fail loudly as 500 — never silently return garbage.
- Admin settings routes carry `@Roles('admin','super_admin')`; the global RBAC guard (B1.2) enforces role/status — until B1.3 attaches identity to requests they respond 401 UNAUTHENTICATED.

## 1b. RBAC semantics (B1.2)

- Roles: `guest` (implicit, unauthenticated), `user`, `owner`, `moderator`, `admin`, `super_admin`.
- Route protection: `@Public()` skips auth entirely; `@Roles(...)` requires an authenticated ACTIVE user satisfying ANY listed role; `super_admin` satisfies every requirement. Routes with neither decorator must be genuinely public or ownership-checked inside the service (AGENTS.md 6/9).
- No identity attached (pre-B1.3) → 401 `UNAUTHENTICATED`; blocked account → 403 `FORBIDDEN`; insufficient role → 403 `FORBIDDEN`.
- Administrability invariant: the LAST active super_admin can be neither demoted nor blocked (409); only a super_admin may demote a super_admin.

## 3. Secrets inventory

Format: where each secret lives and how to rotate it. Never write real values.

| Secret                            | Location (env or settings key) | Used by | Rotation procedure | Prompt |
| --------------------------------- | ------------------------------ | ------- | ------------------ | ------ |
| (filled by prompt B1.1 and later) |                                |         |                    |        |

## 4. Upload policy

Format: one row per upload kind: allowed types, max size, processing, storage path, who can upload, who can read.

## 5. Threat notes

Short notes of known risks and the mitigation implemented, one bullet each, with the prompt ID.
