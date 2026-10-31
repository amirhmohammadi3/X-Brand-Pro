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

## 2b. Rate limits (B1.3 additions)

| Key             | Endpoint(s)         | Limit | Window | Scope                                   | Prompt |
| --------------- | ------------------- | ----- | ------ | --------------------------------------- | ------ |
| `auth.register` | POST /auth/register | 5     | 1 h    | ip (failClosed)                         | B1.3   |
| `auth.login`    | POST /auth/login    | 10    | 10 min | ip + normalized identifier (failClosed) | B1.3   |
| `auth.refresh`  | POST /auth/refresh  | 60    | 60 s   | ip                                      | B1.3   |

- `failClosed` (B1.3): endpoints may opt into rejecting with 503 SERVICE_UNAVAILABLE when the limiter is DEGRADED (Redis unreachable) instead of the platform default fail-open. Auth endpoints use it because an outage must not become an open door. Login additionally fail-OPENS its lockout layer when Redis is down (availability over strictness) — recorded as an accepted risk in Threat notes.
- Login throttling is two-layered: the fixed-window limiter above, plus a CONSECUTIVE-FAILURE lockout (below).

## 2c. Brute-force lockout policy (B1.3)

- Counter key: `auth:fail:<sha256(normalized identifier)>` in Redis; window 15 min (TTL from the first failure).
- After 5 consecutive failures for the same identifier, further attempts return 429 `ACCOUNT_LOCKED` with `details.retryAfterSec` BEFORE any password work.
- A successful login deletes the counter (consecutive semantics). Unknown identifiers count too (prevents user enumeration via lockout), and responses for unknown user vs wrong password are byte-identical (`INVALID_CREDENTIALS`) plus a dummy argon2 verify keeps timing similar.

## 2d. Token & session policy (B1.3)

- Access token: JWT HS256 (`jose`), claims `sub`, `sid`, `role`, `iat`, `exp`, `jti`; TTL `ACCESS_TTL_SEC` (default 900 s = 15 min); signed with `JWT_ACCESS_SECRET` (≥ 32 chars).
- Refresh token: opaque — 32 random bytes base64url. Only its SHA-256 hash is stored (`sessions.refresh_hash` UNIQUE). TTL `REFRESH_TTL_DAYS` (default 30).
- Rotation: every refresh marks the old row `replaced_by` and mints a new row in the same family. Presenting a revoked OR already-replaced token revokes the WHOLE family (`reuse_detected`) and returns 401 `TOKEN_REUSED`.
- Session liveness: the global `JwtAuthGuard` checks `session:active:<sid>` in Redis (60 s TTL cache, DB fallback — fail closed to the DB, never open). Logout/revocation deletes the key, so access tokens die immediately.
- User status cache: `auth:userstatus:<id>` (30 s TTL, DB fallback) — role changes land in new access tokens; status (banned) flips within ≤ 30 s.
- Cookie policy: `at` + `rt` are httpOnly, SameSite=Lax, Secure per `COOKIE_SECURE` (default true in production), Domain per `COOKIE_DOMAIN`, Path `/` (so the F1.8 Next.js middleware can refresh on page requests). Logout/logout-all clear them with the same attributes.
- CSRF: unsafe methods (POST/PUT/PATCH/DELETE) carrying ANY cookie require an `Origin` (or `Referer`) header equal to `PUBLIC_WEB_URL`'s origin → otherwise 403 with messageKey `errors.csrf`. Bearer-only clients (no cookies) have no CSRF surface. Complements SameSite=Lax.
- Log hygiene: pino redacts `authorization`, `cookie`, `set-cookie`, `req.body.password/token/secret/code`; no auth code path logs tokens or passwords (verified by grepping test output).

## 3. Secrets inventory (B1.3 additions)

| Secret                     | Location (env)   | Used by                                                             | Rotation procedure                                                                                | Prompt |
| -------------------------- | ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| `JWT_ACCESS_SECRET`        | env (≥ 32 chars) | TokenService (HS256 sign/verify)                                    | set new value → restart API; all access tokens invalidate within ≤ ACCESS_TTL_SEC                 | B1.3   |
| `JWT_REFRESH_SECRET`       | env (≥ 32 chars) | reserved for keyed refresh derivation; the DB hash is the authority | set new value → restart API (no session impact while unused)                                      | B1.3   |
| `SEED_SUPERADMIN_PASSWORD` | env (seed only)  | super-admin seeder                                                  | change via admin API after first login; the seeder refuses the `.env.example` value in production | B1.3   |

## 1b. RBAC semantics update (B1.3)

- The global guard chain is now: `RateLimitGuard` → `JwtAuthGuard` → `CsrfOriginGuard` → `RolesGuard`.
- `JwtAuthGuard` attaches `req.user = { id, role, status, sessionId }` from a verified access token (bearer first, then the `at` cookie); missing/invalid → 401 `UNAUTHENTICATED`; revoked/expired session → 401 `SESSION_REVOKED`; banned account → 403 `ACCOUNT_BANNED`.
- `@Public()` skips identity (health, auth register/login/refresh, settings/public). `@Roles(...)` routes behave exactly as B1.2 defined — identity now really exists.

## 5. Threat notes

- (B1.3) Stolen refresh token: replay triggers family revocation (`TOKEN_REUSED`) — the attacker and the victim both fall back to re-login; event `auth.token.reuse_detected` is audit-ready (B1.11).
- (B1.3) User enumeration: identical 401 body + dummy verify for unknown users vs wrong passwords; register duplicate errors reveal a field exists (acceptable for a public directory; rate limited 5/h).
- (B1.3) Lockout DoS: an attacker can lock a victim's IDENTIFIER for 15 min (5 failures) — accepted trade-off, standard for password login; the account is never permanently harmed and OTP/social logins (B1.7/B1.8) provide alternate paths.
- (B1.3) Redis outage: limiter + lockout fail open (availability), session liveness and user-status caches fail closed to the DB (correctness) — no revoked session can be resurrected.
- (B1.3) Role staleness: `role` rides the access JWT — a role change applies when the client refreshes (≤ 15 min). B1.14's admin role-change endpoint emits `user.role.changed` for audit; a forced-revocation hook is a follow-up if needed.

## 2e. OTP policy (B1.4)

| Key (Redis)              | Scope          | Limit | Window | Prompt |
| ------------------------ | -------------- | ----- | ------ | ------ |
| `otp:resend:<hash>`      | target+purpose | 1     | 60 s   | B1.4   |
| `otp:hour-target:<hash>` | target         | 5     | 1 h    | B1.4   |
| `otp:hour-ip:<hash>`     | ip             | 20    | 1 h    | B1.4   |

- Codes: numeric, `crypto.randomInt` (uniform, no modulo bias), length `otp.length` (default 6), leading zeros allowed.
- Storage: ONLY HMAC-SHA256(`<id>:<code>`) keyed by `OTP_HMAC_SECRET` — a database leak does not leak codes; comparison via `timingSafeEqual` on equal-length HMAC buffers.
- Attempts: `attempts` increments ATOMICALLY (SQL `attempts + 1`) on every try; after `otp.maxAttempts` (default 5) failures the code is dead (429 `OTP_TOO_MANY_ATTEMPTS`) even for the correct code.
- Invalidation: a new issue for the same target+purpose consumes all previous unconsumed codes.
- OTP errors use 422 (`OTP_INVALID`, `OTP_EXPIRED`) / 429 (`OTP_TOO_MANY_ATTEMPTS`, `OTP_RESEND_TOO_SOON` with `details.retryAfterSec`).
- The plain code is returned ONLY by `OtpService.issue()` to the calling service that sends it (B1.5/B1.6); controllers (B1.7) never see it. Logs carry only the masked target (`maskTarget`).

## 3. Secrets inventory (B1.4 additions)

| Secret            | Location (env)   | Used by                 | Rotation procedure                                                                             | Prompt |
| ----------------- | ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| `OTP_HMAC_SECRET` | env (≥ 32 chars) | OtpService code hashing | rotate → codes issued before rotation become unverifiable (users re-request); safe, low impact | B1.4   |

## 2f. SMS policy (B1.5)

| Key              | Endpoint(s)          | Limit | Window | Scope             | Prompt |
| ---------------- | -------------------- | ----- | ------ | ----------------- | ------ |
| `admin.sms.test` | POST /admin/sms/test | 5     | 60 s   | user (failClosed) | B1.5   |

- Permissions: `@RequirePermissions('settings.manage')` — first consumer of the RBAC permission layer (ROLE_PERMISSIONS static map: admin holds `settings.manage`, super_admin holds `*`). Moderator/owner/user/guest are 403.
- Provider credentials (`sms.melipayamak.username/password`, `sms.kavenegar.apiKey`) are registry secrets: AES-256-GCM encrypted at rest, masked in admin listings, read from SettingsService at SEND time and never logged.
- Logs and the fake-driver console line carry only the masked target (`maskTarget`); message text is NOT logged in production (fake driver logs only outside production).
- The dev outbox endpoint is structurally unavailable in production: the module is not registered unless `DEV_TOOLS=true` with `NODE_ENV != production`, and `loadEnv` fails boot on that combination in production.
- OTP job hygiene: `sendOtp` jobs run with `removeOnComplete: true` and `removeOnFail: { age: 3600 }` so the code never persists in Redis after delivery; the code travels only inside the job payload.
- Residual risk: real-provider send results are not yet verified against live accounts (sandbox has no provider credentials) — both drivers MUST be re-verified with real accounts before production (see PROGRESS Follow-ups).
