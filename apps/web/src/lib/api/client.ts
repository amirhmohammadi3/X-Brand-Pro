import type { ZodType } from 'zod';
import { errorEnvelopeSchema } from '@app/contracts';
import { env } from '../env';
import { ApiRequestError } from './errors';

export type QueryValue = string | number | boolean | null | undefined;
export type QueryRecord = Record<
  string,
  QueryValue | ReadonlyArray<Exclude<QueryValue, null | undefined>>
>;

export type ApiFetchOptions<TBody> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body — serialized as JSON; no body for GET by convention. */
  body?: TBody;
  query?: QueryRecord;
  signal?: AbortSignal;
  /** For unsafe endpoints that create money or external effects (AGENTS.md 6). */
  idempotencyKey?: string;
  /** Extra headers (server client adds cookies here). */
  headers?: Record<string, string>;
};

/**
 * Serialize a query record: skips null/undefined, repeats keys for arrays,
 * always URL-encodes. Deterministic key order (insertion) keeps tests and
 * HTTP caches stable.
 */
export function buildQuery(query?: QueryRecord): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

function joinUrl(path: string, query?: QueryRecord): string {
  const base = env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}${buildQuery(query)}`;
}

/**
 * Envelope-aware fetch used by ALL data access in the web app (TanStack Query
 * hooks and server components alike). The caller supplies the contract schema
 * for the response payload — the client validates the envelope with it, so a
 * shape drift between api and web fails loudly instead of rendering garbage.
 * It never retries (retry policy belongs to the query layer) and never
 * swallows errors (callers get ApiRequestError with messageKey for i18n).
 */
export async function apiFetch<TData, TBody = unknown>(
  path: string,
  dataSchema: ZodType<TData>,
  options: ApiFetchOptions<TBody> = {},
): Promise<{ data: TData; meta?: unknown }> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(joinUrl(path, options.query), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      // Never cache in the browser HTTP cache — TanStack Query owns caching.
      cache: 'no-store',
    });
  } catch (err) {
    if (options.signal?.aborted) throw err; // genuine aborts propagate untouched
    throw new ApiRequestError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : 'Network request failed',
    });
  }

  if (!response.ok || response.status === 204) {
    // Failure envelope (or an unexpected success status without a body).
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (response.status === 204) {
      return { data: undefined as TData };
    }
    const raw: unknown = await safeJson(response);
    const parsed = errorEnvelopeSchema.safeParse(raw);
    if (parsed.success) {
      throw new ApiRequestError({
        status: response.status,
        code: parsed.data.error.code,
        messageKey: parsed.data.error.messageKey,
        message: parsed.data.error.message,
        details: parsed.data.error.details,
        requestId: parsed.data.error.requestId,
      });
    }
    throw new ApiRequestError({
      status: response.status,
      code: 'INVALID_ENVELOPE',
      message: `API returned a non-envelope error response (HTTP ${response.status})`,
      requestId,
    });
  }

  const raw: unknown = await safeJson(response);
  const envelope = zValidateEnvelope(raw, response);
  const dataResult = dataSchema.safeParse(envelope.data);
  if (!dataResult.success) {
    throw new ApiRequestError({
      status: response.status,
      code: 'INVALID_ENVELOPE',
      message: 'API response data does not match the contract schema',
      details: dataResult.error.issues,
      requestId: response.headers.get('x-request-id') ?? undefined,
    });
  }
  const meta = (envelope as { meta?: unknown }).meta;
  return meta === undefined ? { data: dataResult.data } : { data: dataResult.data, meta };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function zValidateEnvelope(
  raw: unknown,
  response: Response,
): { ok: true; data: unknown; meta?: unknown } {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'ok' in raw &&
    (raw as { ok: unknown }).ok === true &&
    'data' in raw
  ) {
    return raw as { ok: true; data: unknown; meta?: unknown };
  }
  throw new ApiRequestError({
    status: response.status,
    code: 'INVALID_ENVELOPE',
    message: 'API returned a response without a success envelope',
    requestId: response.headers.get('x-request-id') ?? undefined,
  });
}
