/**
 * Pure bundle helpers (B1.12) — no Nest, no IO, fully unit-testable.
 *
 * Message shape rules:
 *  - keys are flat dot paths (`auth.login.title`), at least two segments
 *  - seed files are nested JSON and flattened by `flattenMessages`
 *  - values never contain HTML; `{var}` ICU-style placeholders are fine
 *  - bundles compose with fallback to the default locale, and a bundle
 *    NEVER invents a key: missing keys are simply absent
 */
import { createHash } from 'node:crypto';

/** Flatten nested JSON (`{ a: { b: "x" } }` → `{ "a.b": "x" }`). */
export function flattenMessages(nested: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (nested === null || typeof nested !== 'object') return out;
  for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flattenMessages(value, path));
    } else if (typeof value === 'string') {
      out[path] = value;
    }
  }
  return out;
}

/** Compose a locale bundle: missing keys fall back to the default locale. */
export function composeWithFallback(
  defaultMessages: Record<string, string>,
  localeMessages: Record<string, string>,
): Record<string, string> {
  return { ...defaultMessages, ...localeMessages };
}

/** Keep only messages whose key starts with one of the namespaces (first segments). */
export function filterByNamespaces(
  messages: Record<string, string>,
  namespaces: readonly string[] | null,
): Record<string, string> {
  if (!namespaces || namespaces.length === 0) return messages;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    if (namespaces.includes(key.split('.')[0] ?? '')) out[key] = value;
  }
  return out;
}

/** sha1 over the sorted `key=value` lines — first 12 hex chars. */
export function computeBundleVersion(messages: Record<string, string>): string {
  const lines = Object.keys(messages)
    .sort()
    .map((key) => `${key}=${messages[key]}`);
  return createHash('sha1').update(lines.join('\n'), 'utf8').digest('hex').slice(0, 12);
}

/** Control characters (except \n and \t) are stripped from values. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeTranslationValue(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/**
 * HTML tags are NOT allowed in translation values (the web client renders
 * them as plain text). ICU-style `{name}` placeholders are fine. Returns
 * true when the value contains something tag-like.
 */
export function containsHtml(value: string): boolean {
  return /<\/?[a-zA-Z][^>]*>/.test(value);
}

/** `{var}` interpolation — unknown vars render as the empty string. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '',
  );
}
