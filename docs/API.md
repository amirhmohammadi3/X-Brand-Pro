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
