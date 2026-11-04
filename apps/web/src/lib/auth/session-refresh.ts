/**
 * Pure helpers for the session-refresh middleware (F1.8).
 *
 * The proxy (`src/proxy.ts`) calls these to decide whether a page request
 * needs a server-side refresh and to merge the refreshed cookies back into
 * the request. They are pure so the security-relevant logic is unit-tested
 * without the Next.js runtime (test/auth/session-refresh.spec.ts).
 *
 * Cookie names `at` (access JWT) / `rt` (rotating refresh token) are the
 * wire names issued by the API's AuthCookieService (B1.3).
 */

/** Access cookie name (short-lived JWT). */
export const ACCESS_COOKIE = 'at';
/** Refresh cookie name (opaque, rotating). */
export const REFRESH_COOKIE = 'rt';

export interface CookiePair {
  name: string;
  value: string;
}

/**
 * Extract `name=value` from a raw `Set-Cookie` header line. Attributes
 * (Path, Max-Age, HttpOnly, …) are ignored — the pair is only needed to
 * refresh the CURRENT request's cookie jar for server components; the
 * browser gets the original raw header appended verbatim.
 */
export function parseSetCookiePair(raw: string): CookiePair | null {
  const eq = raw.indexOf('=');
  if (eq <= 0) return null;
  const name = raw.slice(0, eq).trim();
  if (name.length === 0) return null;
  const rest = raw.slice(eq + 1);
  const semi = rest.indexOf(';');
  const value = (semi === -1 ? rest : rest.slice(0, semi)).trim();
  return { name, value };
}

/**
 * `exp` claim of an access JWT WITHOUT verifying the signature. This is safe
 * for its single purpose — deciding whether a refresh is WORTH TRYING: the
 * API independently validates the refresh token and rejects stale ones.
 * Anything unparseable (malformed, wrong segment count, missing/non-numeric
 * exp) returns null so the caller treats the token as unusable.
 */
export function accessTokenExpiry(at: string | undefined | null): number | null {
  if (!at) return null;
  const parts = at.split('.');
  const payloadPart = parts.length === 3 ? parts[1] : undefined;
  if (payloadPart === undefined || payloadPart.length === 0) return null;
  try {
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    return payload.exp;
  } catch {
    return null;
  }
}

/**
 * A page request needs a refresh when it carries `rt` but the access cookie
 * is missing, malformed, expired, or within `leewaySec` of expiring (small
 * clock-skew buffer so server components never render with a dying token).
 * No `rt` → nothing to refresh.
 */
export function needsSessionRefresh(
  rt: string | undefined | null,
  at: string | undefined | null,
  nowSec: number,
  leewaySec = 30,
): boolean {
  if (!rt) return false;
  const exp = accessTokenExpiry(at);
  if (exp === null) return true;
  return exp - leewaySec <= nowSec;
}

/**
 * Merge refreshed cookie pairs into a request `Cookie` header: existing
 * entries are kept (first occurrence wins), entries with a refreshed name
 * are replaced by the new value. Returns the merged header string.
 */
export function mergeRequestCookies(
  existing: string | undefined | null,
  updates: ReadonlyArray<CookiePair>,
): string {
  const map = new Map<string, string>();
  for (const part of existing?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name.length === 0) continue;
    if (!map.has(name)) map.set(name, value);
  }
  for (const pair of updates) map.set(pair.name, pair.value);
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}
