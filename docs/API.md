# API

Base path `/api/v1`. Responses use the envelope described in AGENTS.md section 6. Every executing prompt appends its endpoints here, grouped by module, in the order of the prompts.

Block format (copy for each endpoint):

```text
### <METHOD> <path>
- Module: <module name>        - Prompt: <ID>
- Auth: public | any authenticated | role/permission <name> | owner of resource
- Request: <ZodSchemaName in @app/contracts> (query/body/params)
- Response: <ZodSchemaName> (status code)
- Errors: <ERROR_CODE list with status>
- Rate limit: <limit per window and key> | none
- Notes: <idempotency, caching headers, side effects>
```

## Endpoints

### GET /api/v1/settings/public

- Module: settings - Prompt: B1.1
- Auth: public
- Request: none
- Response: PublicSettings (@app/contracts, status 200) — only registry keys flagged `public` and never secrets
- Errors: 500 INTERNAL_ERROR, 429 RATE_LIMITED
- Rate limit: 60 req / 60 s per ip (key `settings.public`)
- Notes: served from the Redis cache (60 s TTL); cache invalidates on every admin write

### GET /api/v1/admin/settings

- Module: settings - Prompt: B1.1
- Auth: role admin | super_admin (denied with 403 until B1.2/B1.3 provide authentication)
- Request: none
- Response: AdminSetting[] (status 200) — secret values are masked as `••••••••`
- Errors: 403 FORBIDDEN
- Rate limit: none
- Notes: lists every registered key with `isDefault` flag; unregistered keys cannot appear

### PUT /api/v1/admin/settings/:key

- Module: settings - Prompt: B1.1
- Auth: role admin | super_admin (denied until B1.2/B1.3)
- Request: UpdateSettingBody (body) + SettingKey (param)
- Response: AdminSetting (status 200)
- Errors: 400 VALIDATION_FAILED (body or per-key schema), 403 FORBIDDEN, 422 UNPROCESSABLE (unknown key)
- Rate limit: none
- Notes: secrets are encrypted (AES-256-GCM) before storage; safe to retry

### DELETE /api/v1/admin/settings/:key

- Module: settings - Prompt: B1.1
- Auth: role admin | super_admin (denied until B1.2/B1.3)
- Request: SettingKey (param)
- Response: AdminSetting (status 200, isDefault true)
- Errors: 403 FORBIDDEN, 422 UNPROCESSABLE (unknown key)
- Rate limit: none
- Notes: removes the override; the registry default becomes effective again

## Response envelope (all endpoints)

Every JSON response uses one of two shapes (defined in `@app/contracts`, `src/envelope.ts`):

Success:

```json
{ "ok": true, "data": <payload>, "meta": <optional pagination/list meta> }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "messageKey": "errors.not_found",
    "message": "<English fallback>",
    "details": {},
    "requestId": "<uuid>"
  }
}
```

## Error codes

Defined in `@app/contracts/src/errors.ts`; HTTP status mapping in `ERROR_HTTP_STATUS`:

| Code                   | HTTP | messageKey                    |
| ---------------------- | ---- | ----------------------------- |
| VALIDATION_FAILED      | 400  | errors.validation_failed      |
| UNAUTHENTICATED        | 401  | errors.unauthenticated        |
| FORBIDDEN              | 403  | errors.forbidden              |
| NOT_FOUND              | 404  | errors.not_found              |
| CONFLICT               | 409  | errors.conflict               |
| RATE_LIMITED           | 429  | errors.rate_limited           |
| PAYLOAD_TOO_LARGE      | 413  | errors.payload_too_large      |
| UNSUPPORTED_MEDIA_TYPE | 415  | errors.unsupported_media_type |
| UNPROCESSABLE          | 422  | errors.unprocessable          |
| SERVICE_UNAVAILABLE    | 503  | errors.service_unavailable    |
| INTERNAL_ERROR         | 500  | errors.internal_error         |

## Pagination query contracts

- Page-based: `page` (default 1, min 1) + `pageSize` (default 20, min 1, max 100), both coerced from strings. Response meta: `page, pageSize, total, totalPages`.
- Cursor-based: `cursor` (opaque string) + `limit` (default 20, max 100). Response meta: `nextCursor (nullable), hasMore`.
- Default sort is explicit and stable, always ending with `id` as the tiebreaker.

## GET /api/v1/health

- Auth: public
- Request: —
- Response schema: `HealthPayload` (see `apps/api/src/modules/health/health.controller.ts`)
- Success: `{ ok: true, data: { status: 'ok' | 'degraded' | 'down', uptimeSec, version, checks: { [name]: 'ok'|'degraded'|'down' } } }`
- Errors: 503 when any critical HealthIndicator is `down` (envelope unchanged, HTTP status 503)
- Rate limit: none (probe endpoint; protected from abuse at the reverse-proxy layer in production)
- Extension point: modules contribute `HealthIndicator` providers on the `HEALTH_INDICATORS` token (db, redis, worker added by later prompts)

## Auth endpoints (B1.3)

All under `/api/v1/auth`. Tokens travel in httpOnly cookies (`at` access JWT, `rt` opaque refresh token — both `SameSite=Lax`, `Secure` per `COOKIE_SECURE`, `Domain` per `COOKIE_DOMAIN`, `Path=/`). Global guard chain order: RateLimit → JwtAuth → CsrfOrigin → Roles. Cookie-bearing unsafe requests require an `Origin` (or `Referer`) matching `PUBLIC_WEB_URL` (messageKey `errors.csrf`) — see `CsrfOriginGuard`.

### POST /api/v1/auth/register

- Module: auth - Prompt: B1.3
- Auth: public
- Request: RegisterBody (body; strict) — username, password (passwordSchema), optional fullName/email/phone/locale; email+phone stored UNVERIFIED
- Response: AuthResult (status 201) — `{ user: CurrentUser, accessExpiresAt }`; sets `at`+`rt` cookies
- Errors: 400 VALIDATION_FAILED (weak password, unknown keys), 409 CONFLICT with `details: { field: 'username'|'email'|'phone' }`, 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE (limiter down — failClosed)
- Rate limit: 5 req / 1 h per ip (key `auth.register`, failClosed)
- Notes: emits `auth.registered`; the response NEVER contains tokens (cookies only)

### POST /api/v1/auth/login

- Module: auth - Prompt: B1.3
- Auth: public
- Request: LoginBody (body; strict) — identifier (username OR email OR phone; Persian digits + phone variants normalized), password
- Response: AuthResult (status 200); sets `at`+`rt` cookies
- Errors: 401 INVALID_CREDENTIALS (identical for unknown identifier and wrong password), 403 ACCOUNT_BANNED (only for the verified owner), 429 ACCOUNT_LOCKED (brute-force lockout, `details.retryAfterSec`), 429 RATE_LIMITED
- Rate limit: 10 req / 10 min per ip+normalized-identifier (key `auth.login`, via LoginThrottleService) — checked BEFORE password verification
- Notes: emits `auth.login.succeeded` / `auth.login.failed`; resets the failure counter on success; rehashes legacy argon2 hashes when parameters were upgraded; stamps `last_login_at`

### POST /api/v1/auth/refresh

- Module: auth - Prompt: B1.3
- Auth: public (refresh token itself is the credential)
- Request: none (reads `rt` cookie) or RefreshBody `{ refreshToken }` for non-browser clients
- Response: AuthResult (status 200) — includes `refreshToken` ONLY when the request presented it in the body; sets rotated `at`+`rt` cookies
- Errors: 401 SESSION_REVOKED (unknown/expired token), 401 TOKEN_REUSED (reuse of a replaced/revoked token — burns the whole family), 403 ACCOUNT_BANNED, 429 RATE_LIMITED, 403 FORBIDDEN (cookie + missing/mismatching Origin)
- Rate limit: 60 req / 60 s per ip (key `auth.refresh`)
- Notes: rotation marks the old session row `replaced_by` and mints a new row in the SAME family; reuse revokes the entire family with reason `reuse_detected` and emits `auth.token.reuse_detected`

### POST /api/v1/auth/logout

- Module: auth - Prompt: B1.3
- Auth: any authenticated (bearer or cookie)
- Request: none
- Response: empty (status 204); clears both cookies
- Errors: 401 UNAUTHENTICATED
- Rate limit: none
- Notes: revokes ONLY the current session (`revoked_reason=logout`); the access token stops working immediately (guard checks session liveness); emits `auth.logout`

### POST /api/v1/auth/logout-all

- Module: auth - Prompt: B1.3
- Auth: any authenticated
- Request: none
- Response: empty (status 204); clears cookies
- Errors: 401 UNAUTHENTICATED
- Rate limit: none
- Notes: revokes ALL of the user's sessions including the current one (reason `logout_all`); emits `auth.session.revoked` per session

### GET /api/v1/auth/me

- Module: auth - Prompt: B1.3
- Auth: any authenticated
- Request: none
- Response: CurrentUser (status 200) — fresh DB read, no password hash
- Errors: 401 UNAUTHENTICATED / SESSION_REVOKED, 403 ACCOUNT_BANNED
- Rate limit: none

### POST /api/v1/auth/otp/request

- Module: auth (B1.7) - Prompt: B1.7
- Auth: public
- Request: OtpRequestBody (body; strict) — `channel: 'sms'|'email'`, `target` (iranMobileSchema / emailSchema per channel)
- Response: OtpRequestResult (status 201) — `{ resendAfterSec, expiresInSec, channel, targetMasked }` — IDENTICAL for known and unknown targets
- Errors: 400 VALIDATION_FAILED, 422 OTP_RESEND_TOO_SOON (1/60 s per target+purpose; 5/h per target, 20/h per ip caps), 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE (failClosed limiter)
- Rate limit: 10 req / 1 h per ip (key `auth.otp.request`, failClosed)
- Notes: issues and SENDS the code (SMS via `SmsService.sendOtp`, email via the `otp` template); the response never reveals whether an account exists

### POST /api/v1/auth/otp/verify

- Module: auth (B1.7) - Prompt: B1.7
- Auth: public
- Request: OtpVerifyBody (body; strict) — `channel`, `target`, `code`
- Response: AuthResult (status 200) — same shape as password login; httpOnly cookies set
- Errors: 400 VALIDATION_FAILED, 403 ACCOUNT_BANNED, 422 OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS, 429 RATE_LIMITED
- Rate limit: 20 req / 1 h per ip (key `auth.otp.verify`, failClosed)
- Notes: unknown target → creates a user (throwaway username `u` + 8 base36 chars, no password, target verified, locale from Accept-Language else site default) and logs in; unverified registered target → logs into THAT user and flips the verified stamp (ownership proven by the code); emits `auth.login.succeeded` with `method: 'otp_sms'|'otp_email'` (and `auth.registered` for new users)

### POST /api/v1/auth/verify/request

- Module: auth (B1.7) - Prompt: B1.7
- Auth: any authenticated
- Request: VerifyRequestBody (body; strict) — `channel`, `target` (current pending identifier or a NEW one)
- Response: OtpRequestResult (status 201)
- Errors: 400 VALIDATION_FAILED, 409 CONFLICT (new identifier already belongs to a VERIFIED account), 422 OTP_RESEND_TOO_SOON, 429 RATE_LIMITED
- Rate limit: 5 req / 1 h per user (key `auth.verify.request`, failClosed)
- Notes: purpose `verify_email` / `verify_phone`; email uses the `verify-email` template, phone the `otp` template

### POST /api/v1/auth/verify/confirm

- Module: auth (B1.7) - Prompt: B1.7
- Auth: any authenticated
- Request: VerifyConfirmBody (body; strict) — `channel`, `target`, `code`
- Response: CurrentUser (status 200) with the verified stamp set
- Errors: 400 VALIDATION_FAILED, 409 CONFLICT (re-checked inside the attach transaction), 422 OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS, 429 RATE_LIMITED
- Rate limit: 20 req / 1 h per user (key `auth.verify.confirm`, failClosed)
- Notes: attaches the identifier and marks it verified atomically; an UNVERIFIED other holder loses the identifier (takeover rule), a VERIFIED other holder → 409

### POST /api/v1/auth/password/forgot

- Module: auth (B1.7) - Prompt: B1.7
- Auth: public
- Request: ForgotPasswordBody (body; strict) — `identifier` (username, email or phone)
- Response: ForgotPasswordResult — `{ ok: true }` (status 200) — ALWAYS, regardless of account existence
- Errors: 400 VALIDATION_FAILED, 422 OTP_RESEND_TOO_SOON (per-identifier 3/h cap), 429 RATE_LIMITED
- Rate limit: 5 req / 1 h per ip (key `auth.password.forgot`, failClosed)
- Notes: when the identifier matches a VERIFIED email (preferred) or VERIFIED phone, a `reset_password` code is sent (email template `reset-password`, SMS plain code); otherwise nothing is delivered with the same response

### POST /api/v1/auth/password/reset

- Module: auth (B1.7) - Prompt: B1.7
- Auth: public
- Request: ResetPasswordBody (body; strict) — `identifier`, `code`, `newPassword` (passwordSchema)
- Response: empty (status 204)
- Errors: 400 VALIDATION_FAILED, 422 OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS, 429 RATE_LIMITED
- Rate limit: 10 req / 1 h per ip (key `auth.password.reset`, failClosed)
- Notes: verifies the `reset_password` code against the SAME preferred verified channel it was sent to (a login-purpose code fails), sets the argon2id hash and revokes ALL of the user's sessions

### GET /api/v1/auth/sessions

- Module: auth - Prompt: B1.3
- Auth: any authenticated
- Request: none
- Response: SessionView[] (status 200) — id, userAgent, ip (masked `a.b.c.xxx`), createdAt, lastUsedAt, current
- Errors: 401 UNAUTHENTICATED
- Rate limit: none
- Notes: lists only the caller's ACTIVE sessions; `current: true` marks the session the access token belongs to

### DELETE /api/v1/auth/sessions/:id

- Module: auth - Prompt: B1.3
- Auth: any authenticated (owner of the session)
- Request: id uuid (param)
- Response: empty (status 204)
- Errors: 401 UNAUTHENTICATED, 404 NOT_FOUND (unknown id OR another user's session — no existence leak)
- Rate limit: none
- Notes: revokes with reason `revoked_by_user`

## SMS (B1.5)

### POST /api/v1/admin/sms/test

- Module: sms - Prompt: B1.5
- Auth: permission `settings.manage` (admin and super_admin via ROLE_PERMISSIONS)
- Request: SmsTestBody (body; strict) — `to` (iranMobileSchema, normalized to E.164)
- Response: SmsTestResult (status 200) — `{ driver, ok, providerMessageId?, errorCode? }`
- Errors: 400 VALIDATION_FAILED, 401 UNAUTHENTICATED, 403 FORBIDDEN (missing permission), 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE (limiter down — failClosed)
- Rate limit: 5 req / 60 s per user (key `admin.sms.test`, failClosed)
- Notes: sends a fixed test message through the CURRENTLY configured provider SYNCHRONOUSLY (not queued); provider failures — including unconfigured credentials — come back as `ok: false` with `errorCode` (e.g. `NOT_CONFIGURED`, provider RetStatus), never a 500; the active driver is read from `sms.provider` at call time

### POST /api/v1/admin/email/test

- Module: email - Prompt: B1.6
- Auth: permission `settings.manage` (admin and super_admin via ROLE_PERMISSIONS)
- Request: EmailTestBody (body; strict) — `to` (emailSchema, exactly one recipient)
- Response: EmailTestResult (status 200) — `{ ok, providerMessageId?, errorCode? }`
- Errors: 400 VALIDATION_FAILED, 401 UNAUTHENTICATED, 403 FORBIDDEN (missing permission), 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE (limiter down — failClosed)
- Rate limit: 5 req / 60 s per user (key `admin.email.test`, failClosed)
- Notes: renders the `generic` template and sends SYNCHRONOUSLY through the CURRENTLY configured SMTP transport (not queued); transport failures — including auth/config problems — come back as `ok: false` with `errorCode` (`SMTP_5xx`, `EAUTH`, `ECONNREFUSED`, …), never a 500; effective SMTP settings are `email.smtp.*` / `email.from.*` settings with `SMTP_*` env fallback, read at call time

### Health checks (B0.2/B1.6)

`GET /api/v1/health` aggregates indicators: `postgres` (critical, `select 1` with 2 s timeout) and `smtp` (non-critical, nodemailer `verify()` cached 60 s). Any critical indicator down → HTTP 503 with `status: 'down'`; only non-critical down → 200 with `status: 'degraded'`.

### GET /api/v1/dev/sms-outbox

- Module: sms (dev tools) - Prompt: B1.5
- Auth: public
- Request: none
- Response: DevSmsOutboxItem[] (status 200) — `{ to, text, at }`, newest first
- Errors: none beyond envelope defaults
- Rate limit: none
- Notes: registered ONLY when `DEV_TOOLS=true` AND `NODE_ENV != production` (`loadEnv` rejects that combination in production at boot); reads the `dev:sms:outbox` Redis list written by the fake driver (trimmed to the newest 50); recipients are raw in the list but log lines are masked via `maskTarget`

### GET /api/v1/auth/google/start

- Module: auth (oauth) - Prompt: B1.8
- Auth: public
- Request: query `next` (optional relative path; validated — anything unsafe becomes `/`)
- Response: none (302 redirect to the Google authorization endpoint with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email profile`, `state`, `code_challenge`, `code_challenge_method=S256`)
- Errors: 404 `NOT_FOUND` when `oauth.google.enabled` is false or clientId/clientSecret are unset
- Rate limit: 20 / 10 min per ip (`auth.google.start`, fail-open)
- Notes: seals `state` + PKCE verifier + `next` into a signed httpOnly cookie `oauth_state` (5 min, Path=/api/v1/auth/google, SameSite=Lax). Real logins additionally need real Google credentials configured from the admin settings panel.

### GET /api/v1/auth/google/callback

- Module: auth (oauth) - Prompt: B1.8
- Auth: public
- Request: query `state`, `code` (Google authorization response); `oauth_state` cookie
- Response: none — always 302. Success → `{PUBLIC_WEB_URL}{next}` with `at`/`rt` session cookies set and `oauth_state` cleared. ANY failure (state mismatch/expiry, code exchange failure, ID token invalid, banned account, feature disabled) → `{PUBLIC_WEB_URL}/login?error=oauth_failed` (reason logged server-side only, never in the redirect)
- Errors: no envelope — the endpoint is `@RawResponse()` and redirect-only
- Rate limit: none beyond the global default (state cookie is the gate)
- Notes: account resolution order — (1) existing `oauth_accounts` row by (google, sub) → login; (2) Google-verified email matching an existing user → link; (3) create a user (email stored ONLY when Google reports `email_verified=true`; unverified-email logins get an account WITHOUT email)

### GET /api/v1/auth/oauth/accounts

- Module: auth (oauth) - Prompt: B1.8
- Auth: jwt (any role)
- Request: none
- Response schema: `OauthAccountsResponse` (`packages/contracts/src/auth.ts`) — `{ accounts: [{ id, provider: 'google', email, createdAt }] }`
- Errors: 401 unauthenticated
- Rate limit: global default per ip/user

### DELETE /api/v1/auth/oauth/accounts/:id

- Module: auth (oauth) - Prompt: B1.8
- Auth: jwt (owner only — the id must belong to the caller)
- Request: param `id` (uuid)
- Response: 204 no content
- Errors: 401 unauthenticated, 404 unknown/foreign id, 422 `LAST_LOGIN_METHOD` when it is the caller's only login method (no password, no verified email/phone, no other linked account)
- Rate limit: global default per ip/user

## Media (B1.9)

### POST /api/v1/media/upload

- Module: media - Prompt: B1.9
- Auth: any authenticated user (bearer or cookie)
- Request: multipart/form-data — `file` (binary; multer memory storage, hard cap = the largest per-kind limit) + `kind` field (mediaKindSchema; validated server-side because multipart field order is not reliable)
- Response: UploadMediaResponse (status 201) — `{ id, kind, url, thumbUrl, mime, sizeBytes, width, height }`; urls are `MEDIA_PUBLIC_BASE/<key>` (default `/media/<key>`)
- Errors: 400 VALIDATION_FAILED (unknown `kind`), 401 UNAUTHENTICATED, 403 FORBIDDEN (`business_photo` requires owner/admin/super_admin until B2.7), 413 PAYLOAD_TOO_LARGE (per-kind cap; also multer's LIMIT_FILE_SIZE → 413), 415 UNSUPPORTED_MEDIA_TYPE (valid magic bytes of a disallowed type, e.g. GIF, PDF-for-avatar), 422 UNPROCESSABLE (no magic bytes — text renamed .jpg, SVG — corrupt image, or decompression bomb), 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE (limiter down — failClosed)
- Processing: file-type 22.3.0 magic-byte sniffing (client mime/name never trusted); images re-encoded with sharp 0.35.5 (`autoOrient`, `limitInputPixels` = MAX_IMAGE_PIXELS, ALL metadata stripped, fit-inside 2560 px without enlargement, WebP q82) + 400 px thumbnail (WebP q75); `claim_document` / `message_attachment` PDFs stored untouched (never served inline)
- Rate limit: 30 req / 3600 s per user (key `media.upload`, failClosed)

### DELETE /api/v1/media/:id

- Module: media - Prompt: B1.9
- Auth: owner of the file or admin/super_admin
- Response: `{ deleted: true }` (status 200)
- Errors: 401 UNAUTHENTICATED, 403 FORBIDDEN (not yours), 404 NOT_FOUND (unknown id or already deleted), 422 UNPROCESSABLE (id is not a uuid)
- Notes: SOFT delete (deleted_at) — the physical files (main + thumb) are removed asynchronously by a `media` queue job (worker process, 3 attempts); immediate session/role effects none

### GET /media/<key> (public serving, NOT under /api/v1)

- Module: media - Prompt: B1.9
- Auth: none (public; the key namespace IS the authorization) — `@Public()`, served outside the API prefix via a GET-only global-prefix exclude
- Response: raw bytes streamed from the storage driver (envelope bypassed via @RawResponse)
- Headers: `Content-Type` = stored mime (image/webp for processed images), `Cache-Control: public, max-age=31536000, immutable`, `ETag` (sha256 of key+size, 304 on If-None-Match), `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`
- Range: single-range `bytes=start-end|start-|-suffix` → 206 + `Content-Range`; malformed/out-of-bounds → 416 with `Content-Range: bytes */<size>`
- Errors: 404 NOT_FOUND for unknown keys, deleted rows, path-traversal keys (`..`, `\`, leading `/`) and — deliberately — every PRIVATE kind (`claim_document`, `verification_receipt`, `message_attachment`): those are served later by the authorized endpoints of the prompts that own them

## /api/v1/users/me (B1.10 — profile)

All routes require authentication (JWT access cookie or bearer). Responses use the success envelope with `currentUserSchema` (bio, avatarUrl, hasPassword, updatedAt included). Errors: 400 validation, 401 unauthenticated, 403 CSRF/ownership, 409 conflict, 422 business rule.

### GET /users/me

- Auth: authenticated
- Response: `currentUserSchema` (avatarUrl resolved from the linked media row, thumb preferred)

### PATCH /users/me

- Auth: authenticated
- Request: `updateProfileBodySchema` (strict; displayName 1–80 optional, bio ≤300 nullable optional, locale optional)
- Notes: text is trimmed and Persian-normalized; locale must be `fa`/`en` (region variants map to base) until B1.12 replaces the `LocaleValidator`
- Errors: 400 VALIDATION_FAILED, 422 UNPROCESSABLE (unsupported locale)

### PUT /users/me/avatar

- Auth: authenticated
- Request: `setAvatarBodySchema` ({ mediaId })
- Notes: media must belong to the caller, kind `avatar`, not deleted; the previous avatar is queued for deletion (media queue)
- Errors: 403 (not yours/missing), 422 (wrong kind)

### DELETE /users/me/avatar

- Auth: authenticated
- Response: currentUser with `avatarUrl: null`; old files queued for removal

### POST /users/me/username

- Auth: authenticated — Rate limit `users.change_username` 5/24h
- Request: `changeUsernameBodySchema` ({ username })
- Errors: 409 CONFLICT (taken, details.username), 422 UNPROCESSABLE (cooldown, details.retryAt)

### POST /users/me/password

- Auth: authenticated — Rate limit `users.change_password` 5/15min
- Request: `changePasswordBodySchema` ({ currentPassword?, newPassword })
- Notes: with an existing password `currentPassword` is required (wrong answers count toward login lockout); passwordless accounts set a first password with a verified identifier; all OTHER sessions are revoked, the current one survives
- Errors: 401 INVALID_CREDENTIALS, 422

### DELETE /users/me

- Auth: authenticated
- Request: `deleteAccountBodySchema` ({ password?, confirm: 'DELETE' })
- Notes: soft delete; anonymizes email/phone/password/fullName/bio/avatar, username becomes `deleted_<id[:8]>`; removes OAuth links; revokes all sessions; emits `user.deleted`. User content is kept (rendered anonymous later). Passwordless accounts require a session created within the last 10 minutes.
- Errors: 401, 422 (missing password / stale session)

## /api/v1/admin/audit-logs (B1.11)

- Auth: `audit.read` permission (admin, super_admin) — Rate limit `admin.audit.read` 60/min per user
- Query: `auditListQuerySchema` — `cursor`/`limit` (max 100) + filters `actorId` (uuid), `action` (exact or prefix with trailing `*`), `entityType`, `entityId`, `from`/`to` (ISO datetimes)
- Response: `auditListResponseSchema` — `{ items: AuditLog[], meta: { nextCursor, hasMore } }`, ordered by (created_at desc, id desc) keyset pagination
- Errors: 400 (malformed cursor), 401, 403
- Notes: `before`/`after` payloads are redacted server-side (sensitive keys, depth, length); secrets additionally appear only as the project mask with a `changed` flag

## /api/v1/admin/settings (B1.11 upgrade)

- All three admin routes now require `settings.manage` (was bare @Roles) and are rate limited 60/min per user (`admin.settings.read` / `admin.settings.write`)
- GET returns a GROUPED view: `{ groups: Record<string, AdminSetting[]> }`
- PUT body: `updateSettingBodySchema` — `{ value, clear? }`. Unknown key → 404/422 via registry lookup; secrets are write-only; an EMPTY string on a secret is rejected 422 (keep-unchanged) unless `clear: true`, which removes the override (registry default reapplies)
- DELETE resets to the registry default
- Both mutations emit `settings.updated` (actor + masked before/after) which the audit subscriber records as `settings.update` / `settings.reset`

## /api/v1/i18n (B1.12)

### GET /api/v1/i18n/languages

- Auth: public — Rate limit `i18n.languages` 60/min per IP
- Response: `{ items: Language[] }` (`languageSchema`) — ACTIVE languages only, sorted by sortOrder then code
- Caching: `Cache-Control: public, max-age=60, stale-while-revalidate=300` + weak `ETag`
- Errors: — (empty list when no active languages)

### GET /api/v1/i18n/messages/:locale?namespaces=a,b

- Auth: public — Rate limit `i18n.messages` 120/min per IP
- Query: `messagesQuerySchema` — `namespaces` (comma-separated first key segments)
- Response (raw JSON, no envelope): `messageBundleSchema` — `{ locale, version (sha1[:12]), messages }`
- Fallback: keys missing in `locale` are filled from the DEFAULT locale; never invented
- Caching: `ETag: "<version>"`; `If-None-Match` match → 304 (empty body); `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- Errors: 404 (unknown or INACTIVE locale), 400 (bad namespaces format)

## /api/v1/admin/i18n (B1.12)

- Auth: `i18n.manage` permission (admin, super_admin); audit-logged (`i18n.language.*`, `i18n.translation.*`, `i18n.translations.import`)

| Method | Path                        | Body/Query schema                   | Notes                                                                                                                                                           |
| ------ | --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/i18n/languages       | —                                   | ALL languages (active + inactive)                                                                                                                               |
| POST   | /admin/i18n/languages       | `createLanguageBodySchema`          | starts INACTIVE; no translations copied                                                                                                                         |
| PATCH  | /admin/i18n/languages/:code | `updateLanguageBodySchema`          | default cannot be deactivated; `fa` cannot be deactivated; `isDefault: true` switches atomically (previous default unset in one transaction)                    |
| DELETE | /admin/i18n/languages/:code | —                                   | not default, not `fa`; cascades translations                                                                                                                    |
| GET    | /admin/i18n/translations    | `adminTranslationsQuerySchema`      | `locale` + filters `q`, `namespace`, `missing=true` (keys of the default locale absent in `locale`, with `defaultValue` reference), `page`/`pageSize` (max 100) |
| PUT    | /admin/i18n/translations    | `upsertTranslationsBodySchema`      | batch upsert ≤500 entries; values ≤5000 chars; control chars stripped; HTML tags → 422                                                                          |
| DELETE | /admin/i18n/translations    | `adminTranslationDeleteQuerySchema` | `locale` + `key` query params                                                                                                                                   |
| GET    | /admin/i18n/export/:locale  | —                                   | JSON attachment (`<locale>.json`): every default-locale key, `""` where missing; header `X-Bundle-Version`                                                      |
| POST   | /admin/i18n/import          | `importTranslationsBodySchema`      | `fill_missing` inserts absent keys only; `overwrite` replaces existing/known keys; returns `{ inserted, updated, skipped }`                                     |

- Rate limits: reads `admin.i18n.read` 60/min per user (export 30/min), writes `admin.i18n.write` 60/min per user (import 30/min)
- Errors: 400 (validation), 401, 403, 422 (unknown language, invariant violations, HTML in values)
- Notes: every write bumps the per-locale Redis revision counter, so public bundles re-compose on the next request; admin-edited values are never overwritten by re-seeding

## /api/v1/theme (B1.13)

### GET /api/v1/theme

- Auth: public — Rate limit `theme.active` 120/min per IP
- Response: `activeThemeSchema` — `{ pack: { id, names, tokens }, version: "<id>:<packVersion>:<tokenHash[:8]>" }`
- Caching: active pack cached in Redis 60 s (invalidated on every admin write); `ETag` + `Cache-Control: public, max-age=60, stale-while-revalidate=300`

### GET /api/v1/theme/packs

- Auth: public — Rate limit `theme.list` 60/min per IP
- Response: `{ items: [{ id, names, isActive, version, preview: { light[5], dark[5] } }] }` (bg, surface, primary, text, accent per mode)

### GET /api/v1/theme/packs/:id

- Auth: public — Rate limit `theme.pack` 60/min per IP
- Response: `themePackSchema` (full tokens, for previews) — 404 unknown pack

## /api/v1/admin/theme (B1.13)

- Auth: `theme.manage` permission (admin, super_admin); audit-logged (`theme.active.set`, `theme.tokens.update`, `theme.pack.reset`); rate limit `admin.theme.write` 30/min per user

| Method | Path                         | Body                                         | Notes                                                                                                                                                      |
| ------ | ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | /admin/theme/active          | `setActiveThemeBodySchema` (`{ packId }`)    | switches the active pack via the `theme.activePackId` setting; cache invalidated immediately                                                               |
| PUT    | /admin/theme/packs/:id       | `updateThemeTokensBodySchema` (`{ tokens }`) | server re-validates contrast (WCAG 2.2, docs/DESIGN.md section 5 pairs); 422 with `details.failedPairs` (`{ mode, pair, ratio, min }`); bumps pack version |
| POST   | /admin/theme/packs/:id/reset | —                                            | restores the shipped tokens from `packages/contracts/src/theme/packs.ts`                                                                                   |

- Errors: 400 (validation), 401, 403, 404 (unknown pack), 422 (contrast failures)

## /api/v1/admin/users (B1.14)

- Rate limit: 120/min per user on ALL routes (`admin.users.read` / `admin.users.write`)
- Audit: `users.role_changed`, `users.banned`, `users.unbanned`, `users.sessions_revoked` (actor + before/after)

| Method | Path                             | Permission                         | Body/Query                                                                                                                                     | Notes                                                                                                                                                                                              |
| ------ | -------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/users                     | `users.read` (moderators may read) | `adminUserListQuerySchema` — `q` (search), `role`, `status`, `sort` (createdAt/lastLoginAt/username), `direction`, `page`/`pageSize` (max 100) | `q` matches username/email/displayName (normalized + lowercased, trigram GIN indexes) and phone (digit-only needle ≥3); anonymized (deleted) users never appear; every row carries `sessionsCount` |
| GET    | /admin/users/:id                 | `users.read`                       | —                                                                                                                                              | full `adminUserSchema` view (verification flags, ban fields, sessionsCount)                                                                                                                        |
| PATCH  | /admin/users/:id/role            | `users.manage`                     | `changeRoleBodySchema` (`{ role }`)                                                                                                            | hierarchy rules below; target's sessions are revoked so the new role applies at once                                                                                                               |
| POST   | /admin/users/:id/ban             | `users.manage`                     | `banBodySchema` (`{ reason 3-500, until? future ISO }`)                                                                                        | sets status blocked + reason + time box; revokes all sessions                                                                                                                                      |
| POST   | /admin/users/:id/unban           | `users.manage`                     | —                                                                                                                                              | clears status/reason/until                                                                                                                                                                         |
| POST   | /admin/users/:id/revoke-sessions | `users.manage`                     | —                                                                                                                                              | revokes every active session of the target (except the actor's own)                                                                                                                                |

- Errors: 400 (validation), 401, 403 (permission / rank), 404 (unknown user), 409 (self-target, inactive target, last super_admin, expired `until`, unban of a non-banned user)
- Auto-unban: the `users:expire-bans` repeatable (maintenance queue, every 5 min) lifts expired time-boxed bans; login AND the request guard already treat an expired ban as not banned (`effectiveStatus`), so expiry takes effect immediately with at most a 30 s guard-cache lag.

### Hierarchy rules (enforced server-side)

- Nobody changes their own role or bans themselves.
- Granting/removing `admin` or `super_admin` requires the ACTOR to be `super_admin` (`users.assign_admin`); an `admin` may set `user`/`owner`/`moderator` only.
- Ban: an actor can never ban a user whose role rank is EQUAL or HIGHER (user < owner < moderator < admin < super_admin).
- The last remaining active `super_admin` can never be demoted or banned.
- Role change requires an ACTIVE target.

## /api/v1/cities (B2.1)

- Auth: public (anonymous) — Rate limit `geo.cities` / `geo.city` / `geo.neighborhoods` 120/min per IP
- The list is cached 60 s server-side (Redis) + `Cache-Control: public, max-age=60` + ETag (304 on `If-None-Match` match)

| Method | Path                        | Notes                                                                                                                                                                                                    |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /cities                     | active cities sorted by `sort_order` then `name->>'fa'`; each carries `isDefault` (matches the `geo.defaultCitySlug` public setting); returns the FULL localized name map so the client picks the locale |
| GET    | /cities/:slug               | single active city (`publicCitySchema`); 404 if inactive or unknown                                                                                                                                      |
| GET    | /cities/:slug/neighborhoods | active neighborhoods of an active city, sorted by `sort_order` then `name->>'fa'`                                                                                                                        |

- Errors: 404 (unknown/inactive city)

## /api/v1/admin/cities (B2.1)

- Auth: `catalog.manage` permission (admin, super_admin); audit-logged (`geo.city.create/update/delete/set_active/reorder`, `geo.neighborhood.create/update/delete/reorder`); rate limit `admin.geo.read` / `admin.geo.write` 60/min per user

| Method | Path                                        | Body                                          | Notes                                                                                                                 |
| ------ | ------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/cities                               | —                                             | all cities (active + inactive) with `neighborhoodCount` + `businessCount` (0 until B2.4 registers `BUSINESS_COUNTER`) |
| POST   | /admin/cities                               | `createCityBodySchema`                        | `slug` optional (derived from `name.en`/`name.fa` via `slugify` + `-2` collision suffix); 409 on duplicate slug       |
| PATCH  | /admin/cities/:id                           | `updateCityBodySchema`                        | partial; 409 on slug collision                                                                                        |
| DELETE | /admin/cities/:id                           | —                                             | 422 `details.businessCount` when the city has businesses (deactivate instead)                                         |
| PUT    | /admin/cities/:id/active                    | `setActiveCityBodySchema` (`{ isActive }`)    | deactivation emits `geo.city.deactivated`; cache invalidated                                                          |
| PUT    | /admin/cities/reorder                       | `reorderCitiesBodySchema` (`{ ids: uuid[] }`) | sets `sort_order` by position; all ids must exist (404)                                                               |
| GET    | /admin/cities/:cityId/neighborhoods         | —                                             | all neighborhoods (active + inactive) of the city                                                                     |
| POST   | /admin/cities/:cityId/neighborhoods         | `createNeighborhoodBodySchema`                | nested; unique `(city_id, slug)` → 409                                                                                |
| PATCH  | /admin/cities/:cityId/neighborhoods/:id     | `updateNeighborhoodBodySchema`                | partial                                                                                                               |
| DELETE | /admin/cities/:cityId/neighborhoods/:id     | —                                             |                                                                                                                       |
| PUT    | /admin/cities/:cityId/neighborhoods/reorder | `reorderNeighborhoodsBodySchema` (`{ ids }`)  | scoped to the city                                                                                                    |

- Errors: 400 (validation — bbox, timezone, coordinates), 401, 403 (permission), 404 (unknown city/neighborhood), 409 (slug conflict), 422 (delete with businesses)
