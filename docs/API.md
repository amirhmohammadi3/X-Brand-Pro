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
