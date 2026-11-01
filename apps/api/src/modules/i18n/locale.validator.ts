import { Injectable } from '@nestjs/common';
// I18nService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from './i18n.service.js';

/**
 * Database-backed locale validator (B1.12, replaces the B1.10 static
 * allow-list). Accepts only ACTIVE languages from the languages table;
 * region variants (`fa-IR`) map to their base code. The active-language
 * list is cached by I18nService (60 s), so this stays cheap.
 *
 * On a total cache/DB failure the cached list served the last known good
 * value; if even that is unavailable, `fa` (the seed default, always
 * present) remains accepted — the profile endpoint surfaces a 422 for
 * anything else.
 */
@Injectable()
export class LocaleValidator {
  constructor(private readonly i18n: I18nService) {}

  /** Normalizes `fa-IR` → `fa`; returns null for unsupported/inactive locales. */
  async normalize(locale: string): Promise<string | null> {
    const base = locale.split('-')[0]?.toLowerCase() ?? '';
    if (!base) return null;
    try {
      const active = await this.i18n.getLanguages(true);
      return active.some((l) => l.code === base) ? base : null;
    } catch {
      return base === 'fa' ? 'fa' : null;
    }
  }
}
