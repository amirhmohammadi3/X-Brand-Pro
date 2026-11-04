/**
 * Safe redirect-target validation (F1.8).
 *
 * The `?next=` query parameter lets login/register send the visitor back to
 * the page they came from. It is a classic open-redirect sink, so the value
 * is accepted ONLY when it is a site-relative path: it must start with a
 * single `/`, must not start with `//` (protocol-relative URL), must not
 * contain a backslash (browsers treat `/\` like `//`), and must not contain
 * whitespace or control characters (scheme smugglings like
 * `javascript:alert(1)` never start with `/`, the whitespace rule keeps
 * `/\tjavascript:`-style payloads out too). Everything else falls back to the
 * given fallback (default `/`).
 *
 * Pure and unit-tested (test/auth/next-path.spec.ts).
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (raw === null || raw === undefined) return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
