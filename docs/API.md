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

## /api/v1/categories (B2.2)

- Auth: public (anonymous) — Rate limit `catalog.categories` / `catalog.category` 120/min per IP
- The tree is cached 60 s (Redis) + `Cache-Control: public, max-age=60` + ETag (304 on `If-None-Match`)

| Method | Path              | Notes                                                                                                                                                                           |
| ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /categories       | active two-level tree (roots + active children); a root whose children are all inactive still appears with an empty `children` array; sorted by `sort_order` then `name->>'fa'` |
| GET    | /categories/:slug | active category with its active children (if a root) and a parent summary `{ slug, name }` (if a child); 404 if inactive/unknown                                                |

- Errors: 404 (unknown/inactive category)

## /api/v1/admin/categories (B2.2)

- Auth: `catalog.manage` permission (admin, super_admin); audit-logged (`catalog.category.create/update/delete/set_active/reorder`); rate limit `admin.catalog.read` / `admin.catalog.write` 60/min per user

| Method | Path                         | Body                                                | Notes                                                                                                                                                                                 |
| ------ | ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/categories            | —                                                   | flat list (active + inactive) with `parentId`, `childCount`, `businessCount` (0 until B2.4 registers `CATEGORY_BUSINESS_COUNTER`)                                                     |
| POST   | /admin/categories            | `createCategoryBodySchema`                          | `parentId` optional (null = root); slug optional (derived from name.en/fa); depth rule: a parent must be a root (refused 422 otherwise); 409 on duplicate slug                        |
| PATCH  | /admin/categories/:id        | `updateCategoryBodySchema`                          | partial; moving to another parent allowed only when the node has no children OR becomes a root (parentId null); the new parent must be a root; cycles impossible under the depth rule |
| DELETE | /admin/categories/:id        | —                                                   | 422 when the category has children (`details.hasChildren`) or businesses (`details.businessCount`) — deactivate instead                                                               |
| PUT    | /admin/categories/:id/active | `setActiveCityBodySchema` (`{ isActive }`)          | deactivating a parent does NOT delete children; the public tree hides children of an inactive parent                                                                                  |
| PUT    | /admin/categories/reorder    | `reorderCategoriesBodySchema` (`{ parentId, ids }`) | sets `sort_order` by position; all ids must share the given `parentId` (422 otherwise)                                                                                                |

- Errors: 400 (validation — icon allow-list, accent, kind, name fa), 401, 403 (permission), 404 (unknown category/parent), 409 (slug conflict), 422 (depth/move/delete refusals)

## /api/v1/amenities (B2.3)

- Auth: public (anonymous) — Rate limit `catalog.amenities` 120/min per IP
- Cached 60 s (Redis) + `Cache-Control: public, max-age=60` + ETag (304 on `If-None-Match`)

| Method | Path       | Query            | Notes                                                                                                                                                                                                                                            |
| ------ | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /amenities | `?categorySlug=` | active amenities; when `categorySlug` is given, returns those mapped to the category AND its parent (de-duplicated, the child mapping wins), ordered by mapping `sort_order` then group; a root with no mapping returns its own mapped amenities |

- Errors: 404 (unknown/inactive category when `categorySlug` is given)

## /api/v1/admin/amenities + /api/v1/admin/categories/:id/amenities (B2.3)

- Auth: `catalog.manage` permission (admin, super_admin); audit-logged; rate limit `admin.catalog.read` / `admin.catalog.write` 60/min per user

| Method | Path                            | Body                                                                | Notes                                                                                                                                     |
| ------ | ------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/amenities                | —                                                                   | all amenities (active + inactive)                                                                                                         |
| POST   | /admin/amenities                | `createAmenityBodySchema`                                           | slug optional (derived from name.en/fa); 409 on duplicate slug                                                                            |
| PATCH  | /admin/amenities/:id            | `updateAmenityBodySchema`                                           | partial; 409 on slug conflict                                                                                                             |
| PUT    | /admin/amenities/:id/active     | `setActiveCityBodySchema` (`{ isActive }`)                          | inactive amenities are hidden from the public list                                                                                        |
| DELETE | /admin/amenities/:id            | —                                                                   | 422 `details.businessCount` when used by businesses (`AMENITY_USAGE_COUNTER` stub returns 0 until B2.4); category mappings cascade-delete |
| GET    | /admin/categories/:id/amenities | —                                                                   | the amenity ids mapped to the category, in mapping order                                                                                  |
| PUT    | /admin/categories/:id/amenities | `setCategoryAmenitiesBodySchema` (`{ amenityIds: uuid[] max 100 }`) | replaces the mapping (delete + insert, sort_order by position); 404 if any amenity id is unknown                                          |

- Errors: 400 (validation — icon allow-list, group, name fa), 401, 403 (permission), 404 (unknown amenity), 409 (slug conflict), 422 (delete with business usage)

## /api/v1/businesses (B2.6)

Business catalog CRUD: registration, owner list, public/owner detail, update, status transitions and soft delete. A business is registered by its owner (any authenticated user becomes the owner of what they create; the `ownerId` relationship — not the `owner` role tag — drives manage access) and starts `pending` with `source = 'manual'`. The slug is derived once from the name (Persian-aware `slugify`, falling back to the city's Persian name) with `-2`/`-3` collision suffixing, and never changes after create (stable public URLs). Authorization reuses `assertCanManageBusiness` / `canViewBusinessHours` (B2.5; the owner branch matches by `ownerId`, not the role tag — see DECISIONS B2.6); the status state machine (`businesses.domain.ts`) governs every transition.

| Method | Path                       | Auth                                                                         | Body                                                            | Response / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | -------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /businesses                | authenticated (any role)                                                     | `createBusinessBodySchema`                                      | Creates a business owned by the caller, status `pending`, `source = 'manual'`. Validates: city exists + active, location inside the city bbox (else Iran's rough bbox), neighborhood belongs to the city, primary + secondary categories exist + active, amenities exist + active. Contacts normalised at the edge (Iranian phones → E.164, Instagram/Telegram handles extracted from URLs, WhatsApp → E.164). Returns `businessDetailSchema`. Rate limit `business.write` 30/min per user. |
| GET    | /businesses/me             | authenticated                                                                | —                                                               | `{ items: businessSummarySchema[] }` — every business the caller owns (every status; owner list is never paginated). Rate limit `business.read` 120/min per user.                                                                                                                                                                                                                                                                                                                           |
| GET    | /businesses/:idOrSlug      | public for `active`; owner / `businesses.manage` for non-active              | —                                                               | `businessDetailSchema` by id (UUID) or slug. A non-active business is visible only to its owner (id match) or a `businesses.manage` holder and answered **404 (never 403)** to anyone else (anti-enumeration, matching the hours GET rule). Rate limit `business.read` 120/min per ip.                                                                                                                                                                                                      |
| PATCH  | /businesses/:id            | owner (editable status or `rejected`) or `businesses.manage`                 | `updateBusinessBodySchema` (every field optional)               | Updates scalar fields + replaces the category/amenity join tables when their ids are supplied. Re-validates city bbox / neighborhood / categories / amenities only for the fields being changed. The slug is NOT changed here. Returns `businessDetailSchema`. Rate limit `business.write` 60/min per user.                                                                                                                                                                                 |
| POST   | /businesses/:id/transition | owner (by id match) or `businesses.manage`                                   | `businessTransitionBodySchema` (`{ status, rejectionReason? }`) | Moves the business along the status state machine. The actor is `owner` (by id match) or `admin` (by `businesses.manage`); an actor who is both may use either path. `rejectionReason` is required when `target = rejected` and forbidden otherwise (schema-enforced). Going `active` stamps `published_at` (the repository does it); `rejected → pending` clears the prior reason. Returns `businessDetailSchema`. Rate limit `business.write` 60/min per user.                            |
| DELETE | /businesses/:id            | owner (never-published: `draft`/`pending`/`rejected`) or `businesses.manage` | —                                                               | Soft-deletes (`deleted_at`); the row stays for audit/SEO redirect and drops out of every list/counter. Owners may remove only never-published submissions; a published business (`active`/`suspended`/`closed`) requires an admin — owners should close it instead (`active → closed`). Returns `{ ok: true }`. Rate limit `business.write` 30/min per user.                                                                                                                                |

- Errors: 400 VALIDATION_FAILED (bad body, bad location, non-UUID/non-slug param, unknown transition target), 401 UNAUTHENTICATED, 403 FORBIDDEN (not the owner / not `businesses.manage` / owner editing a non-editable status / owner deleting a published business), 404 NOT_FOUND (unknown city/neighborhood/category/amenity/business; non-active business hidden from a non-owner viewer), 422 UNPROCESSABLE (location outside the bbox; an invalid status transition), 429 RATE_LIMITED.
- Audit: every write logs an audit row — `business.create` (after: slug/name/status), `business.update` (after: slug/name/status), `business.transition` (before: status, after: status/rejectionReason), `business.delete` — via `AUDIT_SERVICE` (fire-and-forget).
- Notes: the status state machine and its actor permissions live in `businesses.domain.ts` (`TRANSITIONS`): `draft → pending` (owner), `pending → active|rejected` (admin), `rejected → pending` (owner), `active → suspended` (admin) / `closed` (owner or admin), `suspended → active` (admin), `closed → active` (owner or admin). HTTP business search/filter (by city, category, `openNow`, bbox, text) is B3.2; photos are B2.7, menu B2.8, claims B2.9.

## /api/v1/businesses/:id/photos (B2.7)

Business photo gallery: ordered pictures per business plus the cover. The flow is two-step — the owner uploads a file first (POST /media/upload, kind `business_photo`, B1.9 limits: 10 MB, magic-byte sniffing, sharp re-encode to WebP + 400px thumbnail) and then attaches the returned media id to a business they manage. Ordering is a full-array permutation and the cover references one of the business's OWN gallery media ids (stored on `businesses.cover_media_id`, so cover and gallery can never disagree). Authorization mirrors the hours/detail endpoints: the GET is public for `active` businesses (404-never-403 otherwise) and every write requires `assertCanManageBusiness`. Every gallery write is audited.

| Method | Path                            | Auth                                                            | Body                                                                  | Response / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/:id/photos          | public for `active`; owner / `businesses.manage` for non-active | —                                                                     | `{ items: businessPhotoSchema[] }` ordered by `sortOrder` ASC (created ASC as tiebreak). Each item: `{ id, businessId, mediaId, url, thumbUrl, width, height, sortOrder, createdAt }`. Rate limit `business.photos.read` 120/min per ip.                                                                                                                                                                                                                                                  |
| POST   | /businesses/:id/photos          | owner (editable status) or `businesses.manage`                  | `attachBusinessPhotoBodySchema` (`{ mediaId }`)                       | Attaches an uploaded media id to the gallery. Validates the media: exists, not soft-deleted, kind `business_photo`, owned by the caller (admins may attach only their own uploads), not already attached elsewhere (409). Enforces `BUSINESS_MAX_PHOTOS = 10` (422). Appends at `max(sortOrder) + 1`; marks the media attached (insert-first / mark-second, rollback on failure — see DECISIONS B2.7). Returns `businessPhotoSchema`. Rate limit `business.photos.write` 60/min per user. |
| PUT    | /businesses/:id/photos/order    | owner (editable status) or `businesses.manage`                  | `reorderBusinessPhotosBodySchema` (`{ photoIds }` — FULL permutation) | Reorders the gallery: `photoIds` must contain every gallery photo exactly once (unknown id → 404, duplicate or omission → 422), each row gets `sortOrder` = its index (one transaction). Returns `{ items }` in the new order. Rate limit `business.photos.write` 60/min per user.                                                                                                                                                                                                        |
| PUT    | /businesses/:id/photos/cover    | owner (editable status) or `businesses.manage`                  | `setBusinessCoverBodySchema` (`{ mediaId }`)                          | Sets `businesses.cover_media_id` to a media id already in THIS business's gallery (404 otherwise; idempotent). Returns `{ items }` (the full gallery — the cover is a property of it). Rate limit `business.photos.write` 60/min per user.                                                                                                                                                                                                                                                |
| DELETE | /businesses/:id/photos/:photoId | owner (editable status) or `businesses.manage`                  | —                                                                     | Removes the gallery row; if the cover pointed at its media it is cleared (race-safe `WHERE cover_media_id = :mediaId`); the media itself is soft-deleted through MediaService (owner or admin), which queues the physical file removal on the `media` worker queue. Returns `{ ok: true }`. Rate limit `business.photos.write` 60/min per user.                                                                                                                                           |

- Errors: 400 VALIDATION_FAILED (bad body), 401 UNAUTHENTICATED, 403 FORBIDDEN (not the uploader / not the owner / not `businesses.manage`), 404 NOT_FOUND (unknown business or photo — including a photo of a DIFFERENT business; non-active business hidden from a non-owner viewer), 409 CONFLICT (media already attached to another business or to a non-gallery flow), 422 UNPROCESSABLE (media kind is not `business_photo`, gallery full, non-UUID path param), 429 RATE_LIMITED.
- Audit: every write logs an audit row — `business.photo.attach` (after: photoId/mediaId/sortOrder), `business.photo.reorder` (after: order), `business.photo.cover` (after: coverMediaId), `business.photo.delete` (before: photoId).
- Notes: upload limits and processing are B1.9's (`media.upload` 30/h per user, fail-closed). The gallery GET reuses `canViewBusinessHours` for the non-active visibility split — the semantics ("active is public; non-active visible to its owner or a `businesses.manage` holder, 404 otherwise") are identical for hours and photos.

## /api/v1/businesses/:id/menu (B2.8)

Business menu / services: named sections, each holding items with an optional price (RIALS — one integer column, no float money) and an optional photo. Photos ride B1.9's POST /media/upload (kind `menu_photo`, 10 MB, sharp WebP + thumb); the payload references the returned media id. The whole menu is replaced ATOMICALLY — the same full-replace semantics B2.5 chose for weekly hours: the payload snapshot BECOMES the menu (rows are recreated server-side; response ids are fresh), which makes "save my edits" one idempotent, race-free call instead of a dozen granular ones. Visibility mirrors hours/photos: the GET is public for `active` (404-never-403 otherwise) and the PUT requires `assertCanManageBusiness`.

| Method | Path                 | Auth                                                            | Body                                                                                   | Response / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/:id/menu | public for `active`; owner / `businesses.manage` for non-active | —                                                                                      | `menuResponseSchema`: `{ sections: [{ id, businessId, name, sortOrder, items: [{ id, sectionId, name, description, price, photoUrl, photoThumbUrl, isAvailable, sortOrder }] }] }` — sections ordered by `sortOrder` (created ASC tiebreak), items likewise. Rate limit `business.menu.read` 120/min per ip.                                                                                                                                                                                                                                                                                                                                                         |
| PUT    | /businesses/:id/menu | owner (editable status) or `businesses.manage`                  | `replaceMenuBodySchema` (`{ sections }` — the full snapshot, ≤20 sections × ≤50 items) | Atomically wipes and recreates the menu: deleted rows cascade, array order becomes `sort_order`, `price` is rials (int ≥ 0, ≤ 1e12, null = not priced), `isAvailable` defaults true. Photo rules: `photoMediaId` must be a kind `menu_photo` media owned by the caller (403 otherwise), not soft-deleted (404), not attached to anything other than THIS business's current menu (409), and unique across the payload (422). NEW photos are marked attached after commit; photos dropped from the payload are soft-deleted through MediaService (physical removal queued). Returns the fresh `menuResponseSchema`. Rate limit `business.menu.write` 30/min per user. |

- Errors: 400 VALIDATION_FAILED (bad body, >20 sections, >50 items/section, price out of range), 401 UNAUTHENTICATED, 403 FORBIDDEN (not the owner / not `businesses.manage` / photo not owned by the caller), 404 NOT_FOUND (unknown business/photo — non-active business hidden from a non-owner viewer), 409 CONFLICT (photo attached elsewhere), 422 UNPROCESSABLE (photoMediaId used by more than one item; non-UUID path param), 429 RATE_LIMITED.
- Audit: the PUT logs `business.menu.replace` (after: section/item counts).
- Notes: a menu photo hard-deleted later (media cleanup) leaves the item intact — the FK is ON DELETE SET NULL. An item id changes on every replace (rows are recreated); nothing references item ids yet (reviews reference the business — B4.x). Menu photos of a soft-deleted media keep serving until the media row is hard-deleted by the cleanup job.

## /api/v1/businesses/:id/claims + /api/v1/businesses/claims (B2.9)

Ownership claims on UNCLAIMED businesses. Any authenticated user files a claim with evidence text (20..2000 chars) and an optional uploaded document (B1.9's POST /media/upload, kind `claim_document` — PDF or image). An admin (`businesses.manage`) approves (the claimant becomes the business owner: `owner_id` + `is_claimed` land in ONE transaction with the claim closing) or rejects (an `adminNote` is required). At most ONE pending claim per business (partial unique index + service check) — a rejected claim does not block a better-evidenced retry. The claimant may cancel their own pending claim.

| Method | Path                               | Auth                                  | Body                                                               | Response / effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/claims/me              | authenticated                         | —                                                                  | `{ items: businessClaimSchema[] }` — the caller's own claims (every status), newest first. Rate limit `business.claims.read` 60/min per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | /businesses/:id/claims             | `businesses.manage`                   | —                                                                  | `{ items: businessClaimSchema[] }` — the business's full claim history (audit trail), newest first. Rate limit `business.claims.read` 60/min per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | /businesses/:id/claims             | authenticated (not the current owner) | `createBusinessClaimBodySchema` (`{ evidence, documentMediaId? }`) | Files a pending claim. Rules: the business must exist and not be deleted (404 — never leaking existence), be unclaimed (`owner_id` null AND `is_claimed` false — else 409 "already claimed" / "you already own"), have no pending claim (409), and the caller must not be its owner (409). The document must be kind `claim_document`, owned by the caller, unattached (404/422/403/409); it is marked attached after the claim insert (crash self-heals via the orphan sweep + SET NULL — DECISIONS B2.9). Rate limit `business.claims.write` 10/hour per user (fail-closed — claims are abuse-prone). |
| POST   | /businesses/claims/:claimId/review | `businesses.manage`                   | `reviewBusinessClaimBodySchema` (`{ decision, adminNote? }`)       | Approve or reject a PENDING claim. `adminNote` is REQUIRED when rejecting and forbidden when approving (schema refine + service re-check). Approve: the repository's transaction sets the claim `approved` and assigns `businesses.owner_id = claimant` + `is_claimed = true` (`WHERE owner_id IS NULL` — a business claimed in the meantime fails with 409, never double-owns). Approving does NOT activate the business (status stays with the B2.6 state machine). Rate limit `business.claims.write` 30/min per user.                                                                               |
| POST   | /businesses/claims/:claimId/cancel | the claimant (own pending claim)      | —                                                                  | Withdraws the claim → `cancelled` (terminal). A stranger gets 403; a decided claim gets 409. Rate limit `business.claims.write` 30/min per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- Errors: 400 VALIDATION_FAILED (bad body, evidence out of 20..2000), 401 UNAUTHENTICATED, 403 FORBIDDEN (not `businesses.manage` for history/review; not the uploader of the document; a stranger cancelling), 404 NOT_FOUND (unknown business/claim/document — including deleted), 409 CONFLICT (already claimed / already own / pending exists / claim not pending / document attached / business claimed mid-review), 422 UNPROCESSABLE (document kind is not `claim_document`; reject without a note; non-UUID path param), 429 RATE_LIMITED.
- Audit: every write logs an audit row — `business.claim.create` (after: claimId/hasDocument), `business.claim.approve` / `business.claim.reject` (before: pending, after: claimId/status/adminNote), `business.claim.cancel`.
- Notes: the document FK is ON DELETE SET NULL (a media hard-delete keeps the claim's audit trail); `reviewed_by` is SET NULL too (an admin account removal must not erase the decision). Claim evidence/documents are visible to the claimant, the (future) business owner and `businesses.manage` only — never publicly.

## /api/v1/businesses/:id/hours (B2.5)

Business opening hours: a weekly schedule (per-weekday intervals or an all-day shortcut, up to 3 non-overlapping intervals a day, midnight-crossing via `close` < `open`, end-of-day via `close = 24:00`), per-date special-day overrides, and a computed "open now" status driven by the business city's IANA timezone. Authorization uses `assertCanManageBusiness` (owner of an editable-status business — `draft`/`pending`/`active`/`suspended` — or the `businesses.manage` permission); a non-active business's hours are visible only to its owner or a `businesses.manage` holder, and answered **404 (never 403)** to anyone else to avoid leaking existence.

| Method | Path                               | Auth                                                            | Body/Query                                                     | Notes                                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /businesses/:id/hours              | public for `active`; owner / `businesses.manage` for non-active | —                                                              | `hoursResponseSchema`: `{ weekly: WeeklyHours, specialDays: SpecialDay[] (next 60 days), openStatus: OpenStatus }`. `openStatus` = `{ isOpen, state: open\|closed\|closing_soon\|opening_soon, nextChangeAt (ISO\|null), todayIntervals }`, computed in the city tz at `now`. Rate limit `business.hours.read` 120/min per ip. |
| PUT    | /businesses/:id/hours              | owner (editable status) or `businesses.manage`                  | `replaceWeeklyHoursBodySchema` (`{ weekly }`)                  | Replaces the whole weekly schedule atomically (delete + insert in one transaction; a failure keeps the old hours). Overlap, weekday uniqueness and the allDay/intervals exclusivity are validated by `weeklyHoursSchema`. Returns `{ weekly }` (the stored schedule). Rate limit `business.hours.write` 60/min per user.       |
| PUT    | /businesses/:id/special-days/:date | owner (editable status) or `businesses.manage`                  | `upsertSpecialDayBodySchema` (`{ closed, intervals?, note? }`) | Upserts the override for `YYYY-MM-DD` (unique per business per date). `closed: true` cancels the day AND cancels the previous day's midnight-crossing tail; otherwise `intervals` replaces the weekly schedule for that date. Returns `specialDaySchema`.                                                                      |
| DELETE | /businesses/:id/special-days/:date | owner (editable status) or `businesses.manage`                  | —                                                              | Removes the override for that date (the weekly schedule applies again). Returns `{ ok: true }`.                                                                                                                                                                                                                                |

- Errors: 400 (validation — bad time format, >3 intervals, overlapping intervals, duplicate weekday, malformed `YYYY-MM-DD`), 401, 403 (not the owner / not `businesses.manage` / owner editing a non-editable status), 404 (business missing or soft-deleted; non-active business hidden from a non-owner viewer)
- Notes: the open-status computation is pure (`computeOpenStatus` in `hours.service.ts`) and DST-correct for any IANA zone via `Intl.DateTimeFormat` (no moment/luxon). The `nextChangeAt` lookahead covers today + tomorrow; it is `null` when the business is open 24h (all-day) or when the next change is more than a day away. Search filtering by `openNow` is B3.2.

## /api/v1/search (B3.2)

Public business search: free-text `q` (Persian/Arabic-normalized + matched against the B3.1 weighted `search_vector`), facet filters (city, neighborhood, categories, amenities, tags, price level, minimum rating), an optional geo origin + radius (meters) for `ST_DWithin` filtering and `distance` sort, and four sort modes. Returns ranked, paginated hits — only `active`, non-soft-deleted businesses.

| Method | Path    | Auth   | Body/Query                  | Notes                                                                                                                                                                                                                                                  |
| ------ | ------- | ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /search | public | `searchQuerySchema` (query) | Response: `searchResultSchema` = `{ items: SearchHit[], meta: PageMeta }`. `SearchHit` is a `BusinessSummary` subset plus `distance` (meters from origin, null when none) and `rank` (ts_rank, 0 when no `q`). Rate limit `search.read` 60/min per ip. |

Query params (all optional unless noted):

- `q` — free text, 1–200 chars; normalized via `normalizePersianText` + `normalizeDigits` before `plainto_tsquery('simple', …)`.
- `cityId`, `neighborhoodId` — UUID facet filters.
- `categoryIds`, `amenityIds`, `tags` — UUID/string arrays; accept `?k=a,b` (comma form, split by a pre-transform pipe) or `?k=a&k=b` (repeat-key form). Max 20 / 40 / 20 entries.
- `priceLevel` — 1..4.
- `minRating` — 0..5, step 0.5.
- `lat`, `lng` — geo origin (must be supplied together); `radius` — meters, 1..50000.
- `sort` — `relevance` (default when `q` present), `rating` (default otherwise), `distance` (requires `lat`+`lng`), `newest`.
- `page` (default 1), `pageSize` (default 20, max 100).

- Errors: 400 (validation — bad UUID, `sort=distance` without origin, `lat` without `lng` or vice versa, params beyond max counts/lengths), 429 (rate limited with `Retry-After`).
- Notes: `openNow` filtering is intentionally NOT supported yet — the weekly-hours + special-days + timezone computation lives in TypeScript (`HoursService.computeOpenStatus`, B2.5) and cannot be expressed in the search SQL without duplicating it; it is recorded as a Follow-up (materialized `currently_open` column or a SQL port). The repository builds one parameterised Drizzle query over the B3.1 `search_vector` GIN + PostGIS `location` GiST + `name_normalized` trigram indexes; `plainto_tsquery` (not `to_tsquery`) is used so bare multi-word user input is AND-joined without throwing. The ORDER BY always appends `id` as the stable tiebreaker (AGENTS.md §6).

## /api/v1/search/suggest (B3.3)

Public auto-suggest typeahead: as the user types a prefix, returns a small, ranked list of matches across one or all of {business, category, neighborhood, city}. Powers the search-box dropdown and the home/explore quick-pickers. Results are Redis-cached (60s TTL) keyed by the normalised prefix + scope + cityId + limit.

| Method | Path            | Auth   | Body/Query                   | Notes                                                                                                                                                                           |
| ------ | --------------- | ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /search/suggest | public | `suggestQuerySchema` (query) | Response: `suggestResultSchema` = `{ items: SuggestHit[] }`. `SuggestHit` = `{ kind, id, slug, label, labelAlt, sublabel, score }`. Rate limit `search.suggest` 120/min per ip. |

Query params:

- `q` — prefix, 1–60 chars; normalised server-side (`normalizePersianText` + `normalizeDigits` + Latin lowercase + SQL-wildcard escape) before the trigram ILIKE / similarity.
- `scope` — `business` | `category` | `neighborhood` | `city` | `all` (default `all`). `all` fetches the four scopes in parallel, dedupes by `(kind, id)`, sorts by `score` desc, caps to `limit`.
- `cityId` — optional; scopes business + neighborhood matches to a city (ignored by category/city scopes). Lets a city-scoped typeahead show only that city's neighborhoods.
- `limit` — default 8, max 20.

- Errors: 400 (validation — empty `q`, `q` > 60 chars, bad `scope`, non-UUID `cityId`, `limit` out of range), 429 (rate limited).
- Notes: matching uses the B3.1 trigram indexes — `name_normalized ILIKE 'prefix%'` (GIN-indexed prefix match) ORed with the `%` similarity operator; ranking is `similarity(name, prefix)` with a prefix-match tiebreaker, then `avg_rating`/`sort_order`. `label` is the Persian display name (`name_fa` for catalog/geo, `name` for businesses); `labelAlt` is the alternate-script name when present; `sublabel` is a disambiguation hint (a business's city name, a neighborhood's city name). Redis failures degrade to a cache miss (CacheService swallows Redis errors), so suggest stays available during a Redis outage. The 12 pure `SuggestService` specs (normalise/cache-key/scope-merge) run green without a DB/Redis.

## /api/v1/map/businesses (B3.4)

Public map endpoint: given the viewport bbox and a MapLibre zoom, returns either grid clusters (zoomed out) or individual business points (zoom ≥ 14) — one shape, switched on `mode`. Feeds the MapLibre map (F3.1/F3.4). Only `active`, non-soft-deleted businesses. Geo-only: no text filter (the B3.1 trigram/tsvector infra is deliberately not involved); if a text filter is added later it composes on the same WHERE builder in `MapRepository`. Results are Redis-cached (60s TTL) keyed by zoom + cityId + bbox corners quantized to 3 decimals (~111 m), so pixel-level panning jitter maps to the same cache cell.

| Method | Path            | Auth   | Body/Query               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | --------------- | ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /map/businesses | public | `mapQuerySchema` (query) | Response: `mapResultSchema` — discriminated union: `{ mode: 'clusters', items: MapCluster[], meta }` or `{ mode: 'points', items: MapPoint[], meta }`. `MapCluster` = `{ location: {lat,lng}, count }` (centroid of members). `MapPoint` = `{ id, slug, name, primaryCategorySlug, location, avgRating, reviewCount, isFeatured }`. `meta` = `{ zoom, total, truncated }`. Rate limit `map.businesses` 120/min per ip. |

Query params:

- `bbox` — `west,south,east,north` (comma-separated decimals; order-validated: east > west, north > south, lat/lng ranges enforced).
- `zoom` — MapLibre zoom, integer 1–22, default 14 (= points mode). `zoom >= 14` → points; below → grid clusters with `cellDeg = 90 / 2^zoom` (≈ a 64px cell at 256px Web-Mercator tiles).
- `cityId` — optional UUID; scopes the viewport to one city.

- Errors: 400 (validation — malformed/short bbox, reversed corners, out-of-range lat/lng, zoom out of 1–22, non-UUID cityId), 429 (rate limited).
- Notes: bbox filtering is a two-part predicate — (1) `location && ST_MakeEnvelope(...)::geography` drives the `businesses_location_idx` GiST index scan (never a seq scan, even for a whole-country bbox), (2) `ST_Within(location::geometry, ST_MakeEnvelope(...))` is the exact planar containment applied post-index-scan (the geography `&&` is a geodesic bounding approximation, slightly more inclusive at high latitudes). Clustering is a deterministic grid: `GROUP BY ST_SnapToGrid(location::geometry, :cellDeg)`, each cluster anchored at `ST_Centroid(ST_Collect(...))` of its actual members, ordered `count DESC, lat, lng` (deterministic output). Points mode caps at `MAP_MAX_POINTS` (1000), ordered `avg_rating DESC, review_count DESC, id ASC`; when the viewport holds more, `meta.truncated = true` and the client should zoom in. `meta.total` (both modes) is the count of matching businesses in the bbox — clusters never truncate. The result is not paginated: clusters cover the whole bbox by construction. The 21 pure `MapService` specs (mode resolution, cell size, quantized cache keys, meta/truncated shapes) run green without a DB/Redis; the repository SQL is integration-tested against Docker (Follow-up).

## /api/v1/search/history + /api/v1/search/popular (B3.5)

Search history (per-user) and popular queries (global). Recording is automatic: every `GET /search` with a non-empty `q` bumps the global popularity counter (`search_queries`) for ALL searchers and — only when a valid access token rides along — upserts the searcher's history row (`search_history`, capped at the newest 20 per user). Recording is best-effort: any stats failure is swallowed so it can never turn a successful search into a 500. The optional user on the public route is resolved by the controller via `TokenService.verifyAccess` (JWT only — no session/status round trips; DECISIONS B3.5), because the global JwtAuthGuard skips @Public routes.

| Method | Path                | Auth   | Body/Query                          | Notes                                                                                                                                                                                                                                                                                           |
| ------ | ------------------- | ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /search/history     | user   | `searchHistoryQuerySchema` (query)  | Response: `searchHistoryResultSchema` = `{ items: SearchHistoryItem[] }`; `SearchHistoryItem` = `{ id, text, cityId, cityName, searchedAt }`, newest-first by `searchedAt` (re-searching moves an entry to the top). Rate limit `search.history.read` 60/min per user.                          |
| DELETE | /search/history     | user   | —                                   | Clears the caller's whole history. Response: `{ deleted: <n> }`. Rate limit `search.history.write` 30/min per user.                                                                                                                                                                             |
| DELETE | /search/history/:id | user   | —                                   | Removes ONE entry; 404 `NOT_FOUND` when the id is unknown or belongs to another user (indistinguishable by design). Response: `{ deleted: 1 }`. Rate limit `search.history.write` 30/min per user.                                                                                              |
| GET    | /search/popular     | public | `popularQueriesQuerySchema` (query) | Response: `popularQueriesResultSchema` = `{ items: PopularQueryItem[] }`; `PopularQueryItem` = `{ text, cityId, cityName, hits, lastSearchedAt }`, ordered `hits DESC, lastSearchedAt DESC, text`. No user data — the global aggregate counter only. Rate limit `search.popular` 60/min per ip. |

Query params:

- `limit` (both GETs) — 1–20, default 10.
- `cityId` (popular only) — optional UUID; scopes the trending list to one city (e.g. the city page's chips). The list is deduped by the canonical query form, so `كافه` and `کافه` are the same counter row.

- Errors: 400 (validation — `limit` out of 1–20, non-UUID `cityId`, non-UUID history id), 401 (history routes without/with an invalid access token), 404 (DELETE /search/history/:id — unknown or foreign id), 429 (rate limited).
- Notes: recording happens AFTER a successful search (never blocks or fails the search itself); a search WITHOUT `q` (facet-only) records nothing; an invalid/expired token on `GET /search` records popularity but not history. The per-user history is pruned to the newest 20 rows on every record (`HISTORY_LIMIT` = 20). The dedup key on both sides is the B3.1/3.2 canonical form (`normalizePersianText` + `normalizeDigits`). Migration `0020_search_stats` adds both tables with `UNIQUE NULLS NOT DISTINCT` constraints (Postgres 16) so the anonymous (NULL `city_id`) variant upserts correctly. The 28 specs in `test/search-stats.service.spec.ts` (pure service) + `test/search-stats.api.spec.ts` (HTTP-level, in-memory stats repo + canned SearchService — the real controllers/guards run) are green in this sandbox; the real-SQL integration (NULLS NOT DISTINCT upserts, prune, popular ordering) is a Docker follow-up.

## /api/v1/businesses/:id/reviews + /api/v1/reviews (B4.1)

Reviews with trust-building aggregates: an authenticated user rates (1..5) and reviews an ACTIVE business — ONE review per user per business (`reviews_one_per_business` unique index; a second create is 409 — edit instead). A review may carry ONE photo (B1.9's POST /media/upload, kind `review_photo`, 10 MB). Rows are created `approved` and count toward `businesses.avg_rating`/`review_count` immediately — the aggregate itself is recomputed asynchronously by the `reviews` queue's `recompute-rating` job (full AVG/COUNT recompute from source, jobId-deduped per business), so it is eventually consistent by design and never inline in the request path. Editing is AUTHOR-only (admins moderate statuses in B4.4, they do not rewrite user content); deleting is author OR `reviews.manage` (moderator/admin takedown); every write is audited and emits `review.created|updated|deleted`.

| Method | Path                    | Auth                                       | Body/Query                                                                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ----------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/:id/reviews | public                                     | `reviewListQuerySchema` (query)                                                           | `{ items: Review[], meta: PageMeta }` — the business's APPROVED reviews, newest first (`reviews_business_list_idx`). The `?status=` filter (the moderation view) requires auth + `reviews.manage` — the caller is resolved from the bearer (JWT-only, no session round trip; anonymous → 401, insufficient role → 403). Rate limit `reviews.read` 60/min per ip.                                                                                                                                                                                                                                                                             |
| GET    | /reviews/me             | authenticated                              | `reviewListQuerySchema` (query; `status` ignored)                                         | `{ items: Review[], meta: PageMeta }` — the caller's own reviews (every status), newest first. Rate limit `reviews.read` 60/min per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | /businesses/:id/reviews | authenticated                              | `createReviewBodySchema` (`{ rating, body, photoMediaId?, receiptMediaId?, checkin? }`)   | 201 + the created review (status `approved`). Rules: business exists + not soft-deleted (404, never leaking existence), status `active` (422), no existing review by the caller (409), photo/receipt kind/ownership/attach validated (404/422/403/409 — marked attached via the media row's `attached_at`). B4.6: `checkin: {lat, lng, at?}` is validated server-side — distance to the business ≤ 250 m (haversine) and the visit time within 30 days back / 300 s forward; a failing proof 422s the WHOLE create (never a silently unverified review). Rate limit `reviews.write` 5/hour per user (fail-closed — reviews are abuse-prone). |
| PATCH  | /reviews/:id            | authenticated (author)                     | `updateReviewBodySchema` (`{ rating?, body?, photoMediaId?, receiptMediaId?, checkin? }`) | 200 + the updated review; `edited_at` stamped. `photoMediaId`/`receiptMediaId`: `null` clears, an id replaces (same validation as create), `undefined` keeps. `checkin` follows the same three-state rule — an object is revalidated against the CURRENT business location (a moved business cannot keep a stale badge). Non-author → 403 (even admins — moderation never rewrites content). Rate limit `reviews.write` 30/min per user.                                                                                                                                                                                                     |
| DELETE | /reviews/:id            | authenticated (author or `reviews.manage`) | —                                                                                         | `{ deleted: true }` (404 unknown). A moderator takedown behaves like an author delete (hard delete + audit + aggregate recompute). Rate limit `reviews.write` 30/min per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Errors: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409 — duplicate review / already-attached media), `UNPROCESSABLE` (422 — inactive business, wrong media kind, garbage path UUID), `VALIDATION_ERROR` (400).

## Review verification — check-in, receipt, badge (B4.6)

The trust badge on a review (`verified: true` in every Review object) means the server CHECKED at least one proof; it is DERIVED per read (`checkin_at IS NOT NULL OR receipt_media_id IS NOT NULL`) and can never drift from the stored proofs. Two proofs exist:

- **Check-in (مکانی/زمانی):** the body carries `checkin: { lat, lng, at? }` (WGS84 degrees; `at` = the claimed visit time, ISO datetime, defaulting to now). The server measures the great-circle distance to the business's PostGIS point and requires ≤ 250 m (`CHECKIN_RADIUS_M`), and requires the visit window `now − 30 days ≤ at ≤ now + 300 s` (`CHECKIN_MAX_AGE_DAYS`, `CHECKIN_FUTURE_TOLERANCE_SEC` — the forward tolerance absorbs device clock skew only). A failing proof is a 422 whose `details` carry the reason (`too_far` + the measured `distanceM` and `radiusM`, `in_future`, `too_old`, `no_business_location`) — an unverified check-in is NEVER stored, so `checkinVerified: true` on a review always means "the server measured it". The raw coordinates are stored for verification/audit ONLY and are never echoed in any response (privacy).
- **Receipt (فیش):** `receiptMediaId` references a B1.9 upload of kind `verification_receipt`, owned by the caller and unattached (the same one-media-one-home rules as the photo — 404 unknown, 403 not yours, 409 attached elsewhere, 422 wrong kind). The receipt is served publicly as `receiptUrl` (the author attached it as proof). Photo and receipt kinds are NOT interchangeable.

The Review response gains `verified`, `checkinVerified`, `checkinAt`, `receiptUrl` (all nullable/boolean as appropriate). Attaching the FIRST proof (at create, or via an author edit) emits `review.verified` with `{ reviewId, businessId, userId, via: ['checkin'|'receipt', …] }` — fired ONCE per flip, never on re-verification (B4.7 reputation subscribes to this). Attached media is stamped `attached_at` after the review write commits (best-effort — the hourly orphan sweep can never delete a live proof, and an attach failure never fails the review).

## User reputation — score, levels, «اولین نظر» (B4.7)

Every review object also carries the author's trust signals: `isFirstReview` (the «اولین نظر» badge — stamped at create when the author had no prior review row of any status; historical, never re-awarded after a delete) and `authorLevel` (`newcomer | contributor | expert | veteran`, derived live off the author's denormalised `users.reputation_points`).

The score is an ASYNC aggregate with the exact B4.1 rating pattern: every reputation-relevant event (`review.created|updated|deleted|status.changed|voted|vote.removed|verified`) enqueues ONE `recompute-reputation` job per affected author on the `reviews` queue (jobId `reputation:<userId>` collapses bursts; the vote/takedown events carry the AUTHOR's id, since it is the author's score that moves). The worker recomputes FROM SOURCE — `10 × approved reviews + 25 × verified proofs + 2 × helpful votes received` (`REPUTATION_POINTS` in contracts) — and writes `users.reputation_points`; a takedown or vote switch can never leave it drifted. Unhelpful votes subtract nothing (their signal is the ratio + moderation); the score is clamped ≥ 0. Levels: 0/50/200/500 points (`REPUTATION_LEVELS` in contracts; i18n owns the labels).

| Method | Path                 | Auth          | Body/Query | Notes                                                                                                                                                                                                                                                                                                                |
| ------ | -------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /users/me/reputation | authenticated | —          | `{ points, level, stats: { approvedReviews, verifiedReviews, helpfulVotesReceived } }` — computed LIVE from source (three indexed scans), never from the possibly-stale denormalised column. Mounted on the reviews controller (the score is a reviews-domain aggregate). Rate limit `reviews.read` 60/min per user. |

## /api/v1/reviews/:id/vote (B4.2)

Helpful/unhelpful votes on reviews — the trust signal the review list renders as «مفید بود / مفید نبود». ONE vote per user per review (`review_votes_one_per_user` unique index): `PUT` casts or switches (same value re-vote = idempotent no-op, opposite value switches in place), `DELETE` withdraws (idempotent — a double-tap is 200, not an error). Votes apply to APPROVED reviews only (pending/rejected are not publicly visible → 422) and self-votes are rejected (422 — helpfulness is social proof from others). The counts are NEVER denormalised: every read derives them from `review_votes` (correlated count subselects off the unique index), so switches and moderation takedowns can never drift the displayed score. `PUT`/`DELETE` answer `{ helpful, unhelpful, myVote }` (`reviewVoteResultSchema`, `myVote: 1 | -1 | null`) and the review objects in every list now carry `helpfulCount`/`unhelpfulCount`. Votes emit `review.voted` / `review.vote.removed` (the B4.5 spam filter and B4.7 reputation build on these) but are deliberately NOT audited — high-volume one-row upserts of no content would flood the audit log; the rate limit + events carry the abuse signal instead.

| Method | Path              | Auth          | Body/Query                                    | Notes                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------- | ------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT    | /reviews/:id/vote | authenticated | `reviewVoteBodySchema` (`{ value: 1 \| -1 }`) | 200 + `{ helpful, unhelpful, myVote }`. First vote inserts, the opposite value switches (unique-index upsert, `updated_at` stamped), the same value is a no-op with the same response. 404 unknown review, 422 non-approved review or self-vote, 400 invalid value. Rate limit `reviews.vote` 30/min per user. |
| DELETE | /reviews/:id/vote | authenticated | —                                             | 200 + `{ helpful, unhelpful, myVote: null }` — idempotent when no vote exists. 404 unknown review. Rate limit `reviews.vote` 30/min per user.                                                                                                                                                                  |

Errors: `UNAUTHENTICATED` (401), `NOT_FOUND` (404), `UNPROCESSABLE` (422 — self-vote / non-approved review / garbage path UUID), `VALIDATION_ERROR` (400 — `value` outside {1, -1}), `RATE_LIMITED` (429).

- Schemas: `reviewVoteBodySchema`, `reviewVoteResultSchema`; `reviewSchema` gained `helpfulCount`/`unhelpfulCount` (additive — older clients ignore them).
- Migration: `0022_review_votes` — table + `review_votes_one_per_user` UNIQUE (review_id, user_id) + `review_votes_user_idx` (user_id, created_at DESC) + CHECK `value IN (1, -1)`; both FKs CASCADE.

## /api/v1/reviews/:id/reply (B4.3)

The business owner's reply to a review — the other half of the trust loop the F4.6 UI renders as «پاسخ صاحب کسب‌وکار». ONE reply per review (`review_replies_one_per_review` unique index): `PUT` posts the first reply or EDITS the same row in place (`created: true|false` distinguishes the two — a second PUT is never a thread), `DELETE` removes it (idempotent — no reply is 200 `{ deleted: false }`, an unknown REVIEW is still 404). Replies attach to APPROVED reviews only (pending/rejected are invisible on the public page → 422, the same rule as votes).

Who may WRITE: the business OWNER (`businesses.owner_id` match, owner-editable status — the same `canManageBusiness` helper as every B2.x manage endpoint) or a `businesses.manage` holder (admin). A `reviews.manage` moderator is deliberately NOT a replier — moderation moderates, it never speaks as the business; it may only TAKE DOWN via DELETE. The reply's own author may also delete (e.g. after an ownership transfer they no longer manage the business but their words are still theirs). Authorship is PROVENANCE: an edit rewrites body + `edited_at` but never `user_id`/`created_at`, so history survives ownership transfers.

The reply is served INLINE on every review object (`reply: ReviewReply | null` in `reviewSchema`) — the business page needs no extra calls. Every reply write is audited (`review.reply.upsert` / `review.reply.delete` — business speech, unlike votes) and emits `review.replied` / `review.reply.updated` / `review.reply.deleted` (hooks for the B4.5 spam filter and the notification prompts). Replies never touch the rating aggregate.

| Method | Path               | Auth                                                                                         | Body/Query                                         | Notes                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUT    | /reviews/:id/reply | authenticated (owner via `owner_id` + owner-editable status, or `businesses.manage`)         | `upsertReviewReplyBodySchema` (`{ body }` 2..1000) | 200 + `{ reply, created }`. First PUT inserts (`created: true`), every further PUT edits the same row in place (`created: false`, `edited_at` stamped, `user_id`/`created_at` kept). 404 unknown review (or the business behind it is soft-deleted — never leaks), 403 not the owner/manage holder, 422 non-approved review. Rate limit `reviews.write` 30/min per user. |
| DELETE | /reviews/:id/reply | authenticated (owner, `businesses.manage`, the reply's author, or `reviews.manage` takedown) | —                                                  | 200 + `{ deleted: true \| false }` — idempotent when no reply exists. 404 unknown review, 403 when the caller is none of the allowed actors. Rate limit `reviews.write` 30/min per user.                                                                                                                                                                                 |

Errors: `UNAUTHENTICATED` (401), `FORBIDDEN` (403 — not owner/manage for PUT; not owner/author/moderator for DELETE), `NOT_FOUND` (404), `UNPROCESSABLE` (422 — non-approved review / garbage path UUID), `VALIDATION_ERROR` (400 — body length 2..1000, unknown keys), `RATE_LIMITED` (429).

- Schemas: `upsertReviewReplyBodySchema`, `upsertReviewReplyResultSchema`, `deleteReviewReplyResultSchema`, `reviewReplySchema`; `reviewSchema` gained `reply` (additive — `null` until the business answers).
- Migration: `0023_review_replies` — table + `review_replies_one_per_review` UNIQUE (review_id) + `review_replies_user_idx` (user_id, created_at DESC) + CHECK `char_length(body) BETWEEN 2 AND 1000`; both FKs CASCADE.

## /api/v1/reports + /api/v1/moderation/\* (B4.4)

Abuse reports and the content moderation queue. ANY authenticated user may report a review or a reply (POST /reports — one report per reporter per target, `content_reports_one_per_reporter`: the abuse signal is cross-user report VOLUME, a duplicate is 409, never a second row). The targets are POLYMORPHIC (`targetType: review | reply` + `targetId`) — existence is validated in the service (404, never leaking the target's kind/state), and content that was hard-deleted after a report STAYS reported: the trail of why content vanished outlives the content, and the moderator dismisses orphaned reports. `details` are required when `category: other`.

The queues and the decisions are `reviews.manage`-only (moderator/admin — the global RolesGuard). The report queue defaults to the PENDING triage, OLDEST first (`content_reports_status_created_idx`); the review queue serves the B4.1 pre-provisioned `pending` statuses the same way. Resolutions: `reviewed` (seen, no violation), `dismissed` (no action needed) and `actioned` (violation handled — the takedown itself rides the B4.1/B4.3 delete endpoints); `pending` is deliberately unreachable on resolution — a decision leaves the queue. Every decision stamps `reviewed_by` + `reviewed_at` and is audited (`moderation.report.resolve` / `moderation.review.status`). A review status flip (approve/reject + moderation-only note) emits `review.status.changed`, and ONLY APPROVED reviews count toward the rating aggregate — the same jobId-deduped recompute as every other review write runs after every real flip (an idempotent same-status flip enqueues nothing).

| Method | Path                           | Auth             | Body/Query                                                                               | Notes                                                                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /reports                       | authenticated    | `createReportBodySchema` (`{ targetType, targetId, category, details? }`)                | 201 + `{ report }` (status `pending`). 400 invalid body (uuid targetId is schema-level), 404 unknown target, 409 duplicate report by the same reporter. Rate limit `moderation.report` 10/hour per user (fail-closed — reports are abuse-prone).                                                                                |
| GET    | /moderation/reports            | `reviews.manage` | `reportQueueQuerySchema` (`?status=&page=&pageSize=`)                                    | `{ items: Report[], meta }` — defaults to the PENDING triage, oldest first. 401 anonymous / 403 insufficient role. Rate limit `moderation.read` 60/min per user.                                                                                                                                                                |
| PATCH  | /moderation/reports/:id        | `reviews.manage` | `resolveReportBodySchema` (`{ status: reviewed\|dismissed\|actioned, resolutionNote? }`) | 200 + `{ report }` — stamps `reviewed_by`/`reviewed_at`, emits `report.resolved` ONLY on a real status change (a note-only re-resolve emits nothing). 404 unknown, 400 `pending` is not settable. Rate limit `moderation.decide` 30/min per user.                                                                               |
| GET    | /moderation/reviews            | `reviews.manage` | `reviewQueueQuerySchema` (`?status=&page=&pageSize=`)                                    | `{ items: Review[], meta }` — defaults to the PENDING queue, oldest first (`reviews_status_created_idx`). Rate limit `moderation.read` 60/min per user.                                                                                                                                                                         |
| PATCH  | /moderation/reviews/:id/status | `reviews.manage` | `moderateReviewStatusBodySchema` (`{ status: approved\|rejected, note? }`)               | 200 + `{ review, moderatorNote }` — the note is moderation-only (never in the public Review DTO). A same-status flip is an idempotent no-op (no event, no recompute); every REAL flip emits `review.status.changed` → the aggregate recompute. 404 unknown, 400 invalid status. Rate limit `moderation.decide` 30/min per user. |

Errors: `UNAUTHENTICATED` (401), `FORBIDDEN` (403 — not `reviews.manage`), `NOT_FOUND` (404), `CONFLICT` (409 — duplicate report), `UNPROCESSABLE` (422 — garbage path UUIDs), `VALIDATION_FAILED` (400), `RATE_LIMITED` (429).

- Schemas: `reportSchema`, `createReportBodySchema`, `resolveReportBodySchema`, `reportQueueQuerySchema`, `reviewQueueQuerySchema`, `moderateReviewStatusBodySchema`, `moderateReviewStatusResultSchema`.
- Migration: `0024_content_reports` — `content_reports` table (3 enums + UNIQUE (target_type, target_id, reporter_user_id) + status/target/reporter indexes + 2 CHECKs) AND `reviews.moderator_note` (+ its CHECK) — the B4.4 fold.

## The automatic spam/fraud filter (B4.5)

Every review create now runs through the automatic filter (`ReviewsSpamService`) BEFORE the insert — the prompt's four signals, any hit demotes the review to `pending` (the B4.4 queue triages it from there) instead of erroring: the author still gets a 201 and simply sees `status: "pending"`; nobody gets filter feedback that would help evade it.

1. **Blocked words** — `moderation.spam.blockedWords` (admin-managed via PUT /admin/settings/:key, default `[]`), matched against the NORMALIZED body (`normalizePersianText`: Arabic yeh/kaf folded, diacritics stripped, ZWNJ unified — so «تبلیغ» catches «التَبلیغ» and every spelling variant).
2. **Duplicate** — the same normalized body the user already posted (ANY business; per-user signal, bounded 50-row scan).
3. **Velocity** — more than `moderation.spam.maxReviewsPerHour` (default 5) reviews by this user inside the current hour bucket (Redis `INCR` counters, TTL 2h, bumped after EVERY successful insert — flagged rows count too, so the queue sees the full pattern).
4. **Wave** — more than `moderation.spam.maxReviewsPerBusinessPerHour` (default 10) reviews for ONE business in the same hour bucket (coordinated review waves).

FAILURE POLICY: every external read is fail-OPEN — a settings outage skips the word signal, a Redis outage skips velocity/wave, and review creation NEVER breaks because the filter degraded. A flagged create emits `review.created` (unchanged) PLUS `review.flagged` with the machine-readable reasons (`blocked_word:<word>`, `duplicate_text`, `velocity`, `wave`) — the B4.4/B4.7 prompts hook these. The approved-only rating aggregate is untouched (pending rows never counted). No new endpoints; the knobs are settings keys, the demoted rows surface through the existing B4.4 queue and the `?status=pending` moderation view.

## /api/v1/businesses/:id/questions + /api/v1/questions/\* (B4.8)

Business Q&A — the «پرسش و پاسخ» block of the business page. Any authenticated user ASKS a question about an ACTIVE business; the business OWNER (`businesses.owner_id` + owner-editable status, the same `canManageBusiness` helper as every manage endpoint) or a `businesses.manage` holder ANSWERS with ONE answer per question (`business_answers_one_per_question` unique index): `PUT` posts the first answer or EDITS the same row in place (`created: true|false` — a second PUT is never a thread). Answers attach to APPROVED questions only (422 otherwise). Authorship is PROVENANCE (edits rewrite body + `edited_at`, never `user_id`/`created_at`); the answer rides INLINE on every question object (`answer: QaAnswer | null`), so one read renders the whole block.

There is deliberately NO one-question-per-user rule (questions are distinct inquiries, unlike reviews) — abuse is bounded by the `qa.ask` rate limit (10/hour, fail-closed) instead. DELETE question: the asker or a `reviews.manage` takedown (the answer cascades). DELETE answer: owner, the answer's author, or a `reviews.manage` takedown — moderation moderates, it never speaks AS the business. The public list is approved-only, newest first; the `?status=` filter is the moderation view (`reviews.manage`-only, the same scheme as the reviews list). Every write is audited and emits `question.created`/`question.updated`/`question.deleted`/`question.answered`/`question.answer.updated`/`question.answer.deleted`.

| Method | Path                      | Auth                                                                                 | Body/Query                                                | Notes                                                                                                                                                                                                                                                                               |
| ------ | ------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/:id/questions | public (`?status=` requires `reviews.manage`)                                        | `qaListQuerySchema` (page/pageSize, `?status=`)           | 200 + `{ items, meta }` — approved questions with their answer inline. 401 anonymous `?status=`, 403 without `reviews.manage`. Rate limit `qa.read` 60/min per ip.                                                                                                                  |
| GET    | /questions/me             | authenticated                                                                        | `qaListQuerySchema`                                       | 200 + `{ items, meta }` — the caller's own questions, EVERY status, newest first. Rate limit `qa.read` 60/min per user.                                                                                                                                                             |
| POST   | /businesses/:id/questions | authenticated                                                                        | `createQaQuestionBodySchema` (`{ body }` 10..500, strict) | 201 + `QaQuestion`. 404 unknown/soft-deleted business (never leaks), 422 non-active business, 400 body validation, 422 garbage path UUID. Rate limit `qa.ask` 10/hour per user, fail-closed.                                                                                        |
| PATCH  | /questions/:id            | authenticated (asker only)                                                           | `updateQaQuestionBodySchema` (`{ body }`, strict)         | 200 + `QaQuestion` (`edited_at` stamped). 404 unknown question, 403 not the asker. Rate limit `qa.write` 30/min per user.                                                                                                                                                           |
| DELETE | /questions/:id            | authenticated (asker or `reviews.manage` takedown)                                   | —                                                         | 200 + `{ deleted: true }`. 404 unknown question, 403 otherwise. The answer cascades with the question. Rate limit `qa.write` 30/min per user.                                                                                                                                       |
| PUT    | /questions/:id/answer     | authenticated (owner via `owner_id` + owner-editable status, or `businesses.manage`) | `upsertQaAnswerBodySchema` (`{ body }` 2..1000, strict)   | 200 + `{ answer, created }`. First PUT inserts (`created: true`), further PUTs edit the same row in place. 404 unknown question (or the business behind it is soft-deleted — never leaks), 403 not owner/manage, 422 non-approved question. Rate limit `qa.answer` 30/min per user. |
| DELETE | /questions/:id/answer     | authenticated (owner, the answer's author, or `reviews.manage` takedown)             | —                                                         | 200 + `{ deleted: true \| false }` — idempotent when no answer exists. 404 unknown question, 403 when the caller is none of the allowed actors. Rate limit `qa.answer` 30/min per user.                                                                                             |

Errors: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `UNPROCESSABLE` (422 — non-active business / non-approved question / garbage path UUID), `VALIDATION_ERROR` (400 — body length windows, unknown keys), `RATE_LIMITED` (429 with `Retry-After`).

- Schemas: `qaQuestionSchema`, `qaAnswerSchema`, `qaListResultSchema`, `createQaQuestionBodySchema`, `updateQaQuestionBodySchema`, `upsertQaAnswerBodySchema`, `upsertQaAnswerResultSchema`, `deleteQaQuestionResultSchema`, `deleteQaAnswerResultSchema`.
- Migration: `0027_business_qa` — enum `qa_status`, tables `business_questions` + `business_answers`, `business_answers_one_per_question` UNIQUE (question_id), 3 question indexes + 1 answer index, CHECKs `business_questions_body_len` (10..500) / `business_answers_body_len` (2..1000); all FKs CASCADE.

## /api/v1/businesses/:idOrSlug/page (B4.9)

The ONE aggregate read the F4.1 business page needs for first paint. Composition ONLY — every fact comes from a service that already backs its own public endpoint, and the visibility gate is exactly `BusinessesService.getBusinessDetail`'s: `active` businesses for everyone; a non-active business answers 404 unless the caller is its owner or a `businesses.manage` holder (existence never leaks). Resolves by UUID **or slug** (stable public URLs).

Payload (`businessPageSchema`): `business` (BusinessDetail), `hours` (weekly + special days + computed open-status in the city timezone — the same `GET /hours` response), `photos` (the gallery), `menu` (sections + items), `reviews` (the first page of approved reviews + exact list meta; default `pageSize` 5, max 20), `questions.total` (the approved Q&A count — the list itself remains paginated at `GET /businesses/:id/questions`) and `jsonLd` — the schema.org `LocalBusiness` object (`@context`, `@type`, name/alternateName, description, PostalAddress (street + city fa + IR), GeoCoordinates, telephone, image[] from the gallery, `aggregateRating` only when `reviewCount > 0` (schema.org forbids a rating with zero reviews) and `openingHoursSpecification` mapped from the B2.5 weekly schedule — `allDay` → 00:00–23:59, a `24:00` close → `23:59`, closed days omitted). The web client injects `jsonLd` verbatim as `<script type="application/ld+json">`.

| Method | Path                       | Auth                                            | Body/Query                                        | Notes                                                                                                                                                                                                                   |
| ------ | -------------------------- | ----------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /businesses/:idOrSlug/page | public (non-active → owner/`businesses.manage`) | `businessPageQuerySchema` (`?page=&pageSize=≤20`) | 200 + `BusinessPage`. 404 unknown/soft-deleted/non-visible business, 400 query validation. Rate limit `business.page` 60/min per ip. No cache yet — every underlying read is indexed (Redis page-cache is a follow-up). |

Errors: `NOT_FOUND` (404), `VALIDATION_FAILED` (400), `RATE_LIMITED` (429).

- Schemas: `businessPageSchema`, `businessPageQuerySchema`, `businessPageReviewsSchema`, `businessPageQuestionsSchema`, `businessJsonLdSchema`.
- No migration — composition over existing tables.
