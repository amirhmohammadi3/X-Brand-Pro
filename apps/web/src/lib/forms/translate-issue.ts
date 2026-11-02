import type { useTranslations } from 'next-intl';
import type { FieldIssue } from '../api/use-api-mutation';

/**
 * Validation-key translation (F1.4).
 *
 * Convention: a Zod schema's `message` field carries a translation KEY
 * (`validation.required`, `validation.min`, …) rather than a literal string,
 * possibly together with params on the issue's `params` map. `translateIssue`
 * resolves that key through next-intl, falling back to the raw key when the
 * key is unknown (so a missing translation is visible, not silent).
 *
 * The same helper renders server field errors (`FieldIssue`) so client and
 * server errors share one rendering path.
 *
 * Callers should pass a root-scoped translator: `const t = useTranslations();`
 * (no namespace), so that full dotted keys like `validation.required` resolve
 * directly.
 */

type Translations = ReturnType<typeof useTranslations>;

export interface IssueWithKey {
  /** Translation key, e.g. `validation.required`. */
  message: string;
  /** Optional ICU params, e.g. `{ min: 8 }` for `validation.min`. */
  params?: Record<string, unknown>;
}

/**
 * Resolve a Zod issue (or a server `FieldIssue`) to a localized string.
 * Accepts the raw key form (string) and the `{ key, params }` object form.
 */
export function translateIssue(t: Translations, issue: IssueWithKey | FieldIssue | string): string {
  // Plain string form (server FieldIssue shorthand).
  if (typeof issue === 'string') {
    return resolve(t, issue, undefined);
  }
  // Object form: Zod uses `message`, server uses `key`.
  if (typeof issue === 'object' && issue !== null) {
    const key =
      ('key' in issue && typeof issue.key === 'string' && issue.key) ||
      ('message' in issue && typeof issue.message === 'string' && issue.message);
    const params =
      'params' in issue && issue.params && typeof issue.params === 'object'
        ? (issue.params as Record<string, string | number | Date>)
        : undefined;
    if (typeof key === 'string') return resolve(t, key, params);
  }
  return '';
}

function resolve(
  t: Translations,
  key: string,
  params: Record<string, string | number | Date> | undefined,
): string {
  try {
    return params ? t(key, params) : t(key);
  } catch {
    // Unknown key / wrong type — surface the raw key rather than crashing.
    return key;
  }
}
