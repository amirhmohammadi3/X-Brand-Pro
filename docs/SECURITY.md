# SECURITY

Every executing prompt that adds a permission, a rate limit, a secret, an upload, or a new trust boundary updates the matching section.

## 1. Permissions matrix

Format: one row per permission string, one column per role (`user`, `owner`, `moderator`, `admin`, `super_admin`) with `yes` or `no`, plus the endpoints that require it.

| Permission              | user | owner | moderator | admin | super_admin | Endpoints                                                                                    |
| ----------------------- | ---- | ----- | --------- | ----- | ----------- | -------------------------------------------------------------------------------------------- |
| (filled by prompt B1.2) |      |       |           |       |             |                                                                                              |
| `catalog.manage`        | no   | no    | no        | yes   | yes         | `/admin/cities*` (B2.1) — city/neighborhood CRUD; delete refused while a city has businesses |

## 2. Rate limits

Format: one row per limited endpoint group.

| Key                                                                   | Endpoint(s)                                              | Limit | Window | Scope (ip, user, ip+identifier) | Prompt |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ----- | ------ | ------------------------------- | ------ |
| (per-endpoint rows are added by the prompts that own those endpoints) |                                                          |       |        |                                 |        |
| `geo.cities` / `geo.city` / `geo.neighborhoods`                       | GET /cities, /cities/:slug, /cities/:slug/neighborhoods  | 120   | 60s    | ip                              | B2.1   |
| `admin.geo.read`                                                      | GET /admin/cities\*, /admin/cities/:cityId/neighborhoods | 60    | 60s    | user                            | B2.1   |
| `admin.geo.write`                                                     | POST/PATCH/DELETE/PUT /admin/cities\*                    | 60    | 60s    | user                            | B2.1   |

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

| Secret                     | Location (env or settings key)                                                       | Used by                                   | Rotation procedure                                                                                                                                                                                                                                                                           | Prompt |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| JWT_ACCESS_SECRET          | env                                                                                  | token signing (access tokens, 15 min TTL) | `pnpm env:init` after emptying the key, restart. Invalidates ALL access tokens within ≤ ACCESS_TTL_SEC (users must re-login). Refresh tokens stay valid.                                                                                                                                     | I1.1   |
| JWT_REFRESH_SECRET         | env                                                                                  | token signing (refresh tokens, 30 d)      | Same procedure; forces re-login everywhere (all refresh chains die).                                                                                                                                                                                                                         | I1.1   |
| OTP_HMAC_SECRET            | env                                                                                  | one-time-code hashing                     | Same procedure; in-flight OTP codes stop verifying (users request a new code).                                                                                                                                                                                                               | I1.1   |
| SETTINGS_ENCRYPTION_KEY    | env (AES-256-GCM key material)                                                       | secret settings values at rest            | Run `scripts/rotate-settings-key.cli.ts` with the app STOPPED: it decrypts every secret setting with the OLD key and re-encrypts with `SETTINGS_ENCRYPTION_KEY_NEW` in ONE transaction (rollback-safe; see test/settings.rotation.spec.ts). Then update the key in `.env` and start the app. | I1.1   |
| SMTP password              | settings key `email.smtp.password` (encrypted at rest)                               | email driver                              | Edit from the admin settings API — the value is re-encrypted with the current SETTINGS_ENCRYPTION_KEY.                                                                                                                                                                                       | B1.6   |
| SMS provider credentials   | settings keys `sms.melipayamak.password`, `sms.kavenegar.apiKey` (encrypted at rest) | SMS drivers                               | Same as SMTP password.                                                                                                                                                                                                                                                                       | B1.5   |
| Google OAuth client secret | settings key `oauth.google.clientSecret` (encrypted at rest)                         | Google login                              | Same as SMTP password; also update the Google console if needed.                                                                                                                                                                                                                             | B1.8   |

Rules: secrets never live in the repository (`scripts/check-secrets.mjs` scans tracked files and fails on credential-shaped strings; intentional test data is marked `// fake-secret`); secret settings values are AES-256-GCM envelopes (`v1.<iv>.<tag>.<ciphertext>`), masked as `[REDACTED]` in admin listings, and are never returned after write.

## 4. Upload policy

Format: one row per upload kind: allowed types, max size, processing, storage path, who can upload, who can read.

Filled by B1.9 (`POST /api/v1/media/upload`); attaching to entities adds the owner checks of the prompt that owns the entity (e.g. B2.7 for business photos).

| Kind                 | Allowed (magic bytes)      | Max size | Processing                                                               | Storage key                                    | Who can upload                                        | Who can read                     |
| -------------------- | -------------------------- | -------- | ------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| avatar               | jpeg, png, webp, avif      | 2 MB     | re-encode WebP q82, strip metadata, autoOrient, <=2560 px + 400 px thumb | avatar/yyyy/mm/<uuid>.webp                     | any authenticated user                                | public via /media                |
| business_photo       | jpeg, png, webp, avif      | 10 MB    | same                                                                     | business_photo/yyyy/mm/<uuid>.webp             | owner/admin/super_admin (B2.7 adds attach-time check) | public via /media                |
| review_photo         | jpeg, png, webp, avif      | 10 MB    | same                                                                     | review_photo/yyyy/mm/<uuid>.webp               | any authenticated user                                | public via /media                |
| menu_photo           | jpeg, png, webp, avif      | 10 MB    | same                                                                     | menu_photo/yyyy/mm/<uuid>.webp                 | any authenticated user                                | public via /media                |
| claim_document       | jpeg, png, webp, avif, pdf | 15 MB    | images re-encoded; PDF stored UNTOUCHED, never served inline             | claim_document/yyyy/mm/<uuid>.{webp,pdf}       | any authenticated user                                | private (moderation flow only)   |
| message_attachment   | jpeg, png, webp, avif, pdf | 10 MB    | same as claim_document                                                   | message_attachment/yyyy/mm/<uuid>.{webp,pdf}   | any authenticated user                                | private (chat participants only) |
| verification_receipt | jpeg, png, webp, avif, pdf | 10 MB    | same as claim_document                                                   | verification_receipt/yyyy/mm/<uuid>.{webp,pdf} | any authenticated user                                | private (moderation flow only)   |

Hard rules enforced by the media module (B1.9):

- The client mime type and file name are NEVER trusted: the real type comes from magic bytes (file-type 22.3.0). A text file renamed `.jpg` → 422; SVG (scriptable) and GIF are rejected outright; a PDF for an image-only kind → 415.
- Decompression bombs: sharp `limitInputPixels` = `MAX_IMAGE_PIXELS` (default 50 M px) rejects oversized declared canvases → 422.
- All metadata (EXIF incl. GPS) is stripped on re-encode; orientation is APPLIED (autoOrient) so the visual result is upright without the tag.
- Files are stored with random server-side uuid names under `STORAGE_ROOT`; keys are validated on every driver call (`..`, backslash, absolute → rejected) and resolved inside the root.
- `GET /media/<key>` serves ONLY public kinds (avatar, business_photo, review_photo, menu_photo) and returns 404 for private kinds' keys, deleted rows and traversal keys. Private documents get `Content-Disposition: attachment` from their owning endpoints (B2.9/B5.x), never inline rendering here.
- Deletion is a soft delete + queued file removal (3 attempts); unattached uploads are reaped after 24 h.

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

| Key                    | Endpoint(s)                | Limit | Window | Scope             | Prompt |
| ---------------------- | -------------------------- | ----- | ------ | ----------------- | ------ |
| `admin.sms.test`       | POST /admin/sms/test       | 5     | 60 s   | user (failClosed) | B1.5   |
| `admin.email.test`     | POST /admin/email/test     | 5     | 60 s   | user (failClosed) | B1.6   |
| `auth.otp.request`     | POST /auth/otp/request     | 10    | 1 h    | ip (failClosed)   | B1.7   |
| `auth.otp.verify`      | POST /auth/otp/verify      | 20    | 1 h    | ip (failClosed)   | B1.7   |
| `auth.verify.request`  | POST /auth/verify/request  | 5     | 1 h    | user (failClosed) | B1.7   |
| `auth.verify.confirm`  | POST /auth/verify/confirm  | 20    | 1 h    | user (failClosed) | B1.7   |
| `auth.password.forgot` | POST /auth/password/forgot | 5     | 1 h    | ip (failClosed)   | B1.7   |
| `auth.password.reset`  | POST /auth/password/reset  | 10    | 1 h    | ip (failClosed)   | B1.7   |

- Permissions: `@RequirePermissions('settings.manage')` — first consumer of the RBAC permission layer (ROLE_PERMISSIONS static map: admin holds `settings.manage`, super_admin holds `*`). Moderator/owner/user/guest are 403.
- Provider credentials (`sms.melipayamak.username/password`, `sms.kavenegar.apiKey`) are registry secrets: AES-256-GCM encrypted at rest, masked in admin listings, read from SettingsService at SEND time and never logged.
- SMTP password (`email.smtp.password`) is a registry secret (B1.6): AES-256-GCM encrypted at rest, masked in admin listings, resolved with the `SMTP_PASSWORD` env fallback at SEND time and never logged. The SMTP driver rebuilds its pooled transport when the settings hash changes; the hash covers host/port/secure/user/password but is never emitted. Mailpit (dev) runs unauthenticated on localhost:1025.
- Logs and the fake-driver console line carry only the masked target (`maskTarget`); message text is NOT logged in production (fake driver logs only outside production).
- The dev outbox endpoint is structurally unavailable in production: the module is not registered unless `DEV_TOOLS=true` with `NODE_ENV != production`, and `loadEnv` fails boot on that combination in production.
- OTP job hygiene: `sendOtp` jobs run with `removeOnComplete: true` and `removeOnFail: { age: 3600 }` so the code never persists in Redis after delivery; the code travels only inside the job payload.
- Residual risk: real-provider send results are not yet verified against live accounts (sandbox has no provider credentials) — both drivers MUST be re-verified with real accounts before production (see PROGRESS Follow-ups).

## Anti-enumeration (B1.7)

- `POST /auth/otp/request` and `POST /auth/password/forgot` always issue/deliver (or silently skip) and always answer with the same status + body shape, so responses never reveal whether an account exists.
- Account existence becomes visible only at `otp/verify` — the CODE is the ownership gate, and codes are 6 random digits (crypto.randomInt) with HMAC-at-rest, 5 attempts, 120 s TTL and 1/60 s resend cooldown.
- Takeover rule: proving ownership of an identifier by OTP detaches it from any UNVERIFIED holder and verifies it on the prover; VERIFIED holders are never displaced (409 instead).
- Residual risk: timing differences between the "issue+send" and "skip send" branches (an SMTP/SMS submission takes time) are measurable in principle. Reducing them (dummy sends) would burn provider quota on every enumeration attempt; accepted for now and re-evaluated in Q12.1.
- A successful password reset (via code) revokes ALL sessions of the user immediately.

## 2g. Google OAuth policy (B1.8)

| name                | endpoint               | limit | window | scope          | prompt |
| ------------------- | ---------------------- | ----- | ------ | -------------- | ------ |
| `auth.google.start` | GET /auth/google/start | 20    | 10 min | ip (fail-open) | B1.8   |

- **State cookie**: `oauth_state` is an HS256 JWT (signed with `JWT_REFRESH_SECRET`, issuer `xbrand:oauth`, audience `oauth-state`, 5-minute expiry), httpOnly, SameSite=Lax, Path=`/api/v1/auth/google`. It carries `state`, the PKCE `code_verifier` and the validated `next`; the callback requires the cookie AND the `state` query param to match, then clears it. Tampered/expired/missing → generic failure redirect.
- **PKCE**: S256 for every flow even though it is a confidential server-side client (defense in depth for the verifier).
- **Redirect validation**: `next` must be a relative path starting with a single `/`; `//`, backslashes and control characters are rejected to `/` — open-redirect attempts are neutralized before sealing AND again at callback time.
- **ID token validation**: signature via Google's JWKS (cached 1 h), issuer `https://accounts.google.com`, audience = configured clientId, standard expiry with jose's clock tolerance. Failures never leak details — the callback redirects to `/login?error=oauth_failed` and logs the reason server-side.
- **Identity resolution**: linking by email happens ONLY when Google reports `email_verified=true`; unverified-email logins create a standalone account WITHOUT an email (no account-takeover via unverified claims). Banned/blocked accounts are rejected at link and login time.
- **Last login method**: unlinking is refused with 422 `LAST_LOGIN_METHOD` when the user has no password, no verified email/phone and no other linked account.
- **Availability**: Google endpoints are commonly unreachable from Iranian servers (no VPN policy), so the feature ships DISABLED (`oauth.google.enabled=false`) and returns 404 until an admin explicitly enables it with credentials; the rest of the platform never depends on it.

## 2h. Media policy (B1.9)

- `POST /api/v1/media/upload`: 30 req / 3600 s per user (key `media.upload`), failClosed (Redis down → 503, no open window).
- `GET /media/<key>`: public, no limiter (immutable CDN-style caching headers; keys are unguessable uuids).
- Upload payloads never touch disk before validation: multer memory storage with a hard cap of the largest per-kind limit (15 MB), per-kind caps enforced right after (413).

## 2e. Rate limits (B1.10 additions)

| Key                     | Endpoint(s)             | Limit | Window | Scope                                                                                              | Prompt |
| ----------------------- | ----------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------- | ------ |
| `users.change_username` | POST /users/me/username | 5     | 24 h   | user (falls back to ip while the guard chain runs before JWT resolution — see PROGRESS Follow-ups) | B1.10  |
| `users.change_password` | POST /users/me/password | 5     | 15 min | user (same fallback)                                                                               | B1.10  |

- Password change wrong-current-password answers count toward the login lockout (`LoginThrottleService.recordFailure`), same 5/15min policy as login.
- Account deletion requires the password when one is set; passwordless (OTP/Google) accounts require a session younger than 10 minutes (fresh-login proof) — no rate limit beyond the shared guard chain.

## 1c. Permission additions (B1.11)

- `audit.read` — admins and super_admins: read the audit trail (GET /admin/audit-logs).
- Audit writes are redacted before insert: keys matching `/pass(word)?|secret|token|api[-_]?key|authorization|cookie|otp|code$/i` → `[redacted]`, depth ≤ 6, strings truncated at 2000 chars; settings secrets additionally contribute only the project mask plus a `changed` boolean. The plaintext can never reach `audit_logs` (covered by a table-scan test).
- Failed-login events are SAMPLED: at most one row per identifier hash per minute (brute-force bursts cannot flood the trail).
- Retention: audit rows are kept 2 years (DATA_MODEL).

- `i18n.manage` — admins and super_admins: manage languages and translations (B1.12, `/admin/i18n/*`). Values are sanitized (control chars stripped) and HTML tags are rejected with 422, so stored messages can be rendered as plain text without injection risk.

- `theme.manage` — admins and super_admins: switch the active theme pack and edit tokens (B1.13, `/admin/theme/*`). Token edits are rejected server-side when any WCAG pair from docs/DESIGN.md section 5 falls below its threshold, so a broken/low-contrast theme can never ship to users.

- `users.read` — moderators, admins and super_admins: list/detail users (GET /admin/users\*). Search is normalized and rate limited 120/min.
- `users.manage` — admins and super_admins: role change, ban/unban, revoke-sessions. `users.assign_admin` is held ONLY by super_admin (an admin granting admin/super_admin is 403 even though the route permission passes). Full hierarchy table in docs/API.md (B1.14 section): no self-target, no equal-or-higher-rank ban, last super_admin is protected, role change revokes the target's sessions immediately.

## 6. Web-app cookies & client storage (F1.1)

| Cookie   | Purpose                                | Flags                                                                | Notes                                                                                                                                                                                                                                       |
| -------- | -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locale` | Persists the visitor's language choice | `SameSite=Lax`, `Secure` in production, max-age 1 year, NOT httpOnly | Non-sensitive UI preference written client-side by `useSwitchLocale` and read by the locale proxy; deliberately exempt from the httpOnly session-cookie rule. Values are validated against the active-language list server-side before use. |

## 7. Web proxy session refresh (F1.8)

The web proxy (`apps/web/src/proxy.ts`) keeps server-rendered sessions fresh: a page request carrying the `rt` cookie but a missing/expired `at` (JWT `exp` parsed WITHOUT signature verification — a 30 s leeway; unparseable = expired) triggers exactly ONE server-side `POST /api/v1/auth/refresh` that forwards only the `rt`.

- **Propagation**: the API's `Set-Cookie` lines are appended verbatim to the browser response (httpOnly/Secure/SameSite attributes preserved — tokens never enter JS) AND merged into the current request's cookie header so server components see the fresh session in the same render.
- **Failure posture**: any failure (API down, 401, timeout 3 s) changes nothing — cookies are never cleared by the proxy, the visitor continues anonymous; no retry, no loop (the call goes directly to the API origin; the matcher excludes `api`/`_next`/static files).
- **CSRF interplay**: the proxy sends `Origin: <request origin>` because the API's `CsrfOriginGuard` requires it for cookie-bearing unsafe requests; in deployments where the web origin differs from `PUBLIC_WEB_URL` the refresh fails open (documented in DECISIONS 2026-11-04 F1.8).
- **Open-redirect guard**: every consumer of the `?next=` parameter (login, Google start link, login-required prompt) runs it through `safeNextPath` — only site-relative paths survive (`//`, `/\`, schemes, whitespace/control chars rejected; fallback `/`), matching the API's own `next` validation in the Google OAuth flow (B1.8).
- **LoginRequiredPrompt** builds `?next=` from the current pathname only (never from arbitrary query strings).
