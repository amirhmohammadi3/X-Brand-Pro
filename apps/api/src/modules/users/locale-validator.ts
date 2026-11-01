import { Injectable } from '@nestjs/common';

/**
 * Locale allow-list for profile updates (B1.10). Until the i18n backend
 * (B1.12) ships the languages table, only `fa` and `en` are accepted; region
 * variants (`fa-IR`, `en-US`) map to their base language. B1.12 replaces this
 * provider with a database-backed check.
 */
@Injectable()
export class LocaleValidator {
  private readonly supported = new Set(['fa', 'en']);

  /** Normalizes `fa-IR` → `fa`; returns null for unsupported locales. */
  normalize(locale: string): string | null {
    const base = locale.split('-')[0]?.toLowerCase() ?? '';
    return this.supported.has(base) ? base : null;
  }
}
