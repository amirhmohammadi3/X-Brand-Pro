import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Language, MessageBundle } from '@app/contracts';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';
// CacheService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import {
  composeWithFallback,
  computeBundleVersion,
  filterByNamespaces,
  interpolate,
} from './i18n.bundle.js';
import { I18N_REPOSITORY, type I18nRepositoryLike } from './i18n.repository.js';

/** Bundle/raw caches live for 10 minutes; invalidation is implicit: every
 * write increments the per-locale counter that is part of the cache key, so
 * the next read misses and re-loads (old entries expire untouched). */
const BUNDLE_TTL_SEC = 600;
const LANGUAGE_LIST_TTL_SEC = 60;

function toLanguage(row: {
  code: string;
  nameNative: string;
  nameEn: string;
  dir: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}): Language {
  return {
    code: row.code,
    nameNative: row.nameNative,
    nameEn: row.nameEn,
    dir: row.dir === 'rtl' ? 'rtl' : 'ltr',
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  constructor(
    @Inject(I18N_REPOSITORY) private readonly repo: I18nRepositoryLike,
    @Inject(REDIS) private readonly redis: RedisLike,
    private readonly cache: CacheService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Active languages for the public endpoint; all languages for admin. */
  async getLanguages(activeOnly: boolean): Promise<Language[]> {
    const key = `i18n:langs:${activeOnly ? 'active' : 'all'}`;
    const rows = await this.cache.wrap(key, LANGUAGE_LIST_TTL_SEC, () =>
      this.repo.listLanguages(activeOnly),
    );
    return rows.map(toLanguage);
  }

  async getLanguage(code: string): Promise<Language | null> {
    const rows = await this.repo.listLanguages(false);
    const found = rows.find((r) => r.code === code);
    return found ? toLanguage(found) : null;
  }

  async getDefaultLocale(): Promise<string> {
    const row = await this.cache.wrap('i18n:default-lang', LANGUAGE_LIST_TTL_SEC, () =>
      this.repo.findDefaultLanguage(),
    );
    return row?.code ?? 'fa';
  }

  /** Per-locale write counter — part of every cache key (see class comment). */
  private async revision(locale: string): Promise<number> {
    try {
      const raw = await this.redis.get(`i18n:rev:${locale}`);
      return raw === null ? 0 : Number(raw);
    } catch {
      return 0; // Redis down → key without revision; cache.wrap still fails open
    }
  }

  private async bumpRevision(locale: string): Promise<void> {
    try {
      await this.redis.incr(`i18n:rev:${locale}`);
    } catch (error) {
      this.logger.warn(`i18n revision bump failed for ${locale}: ${String(error)}`);
    }
  }

  /** Raw (no fallback) messages of one locale, cached 10 min per revision. */
  private async rawMessages(locale: string): Promise<Record<string, string>> {
    const revision = await this.revision(locale);
    return this.cache.wrap(`i18n:raw:${locale}:v${revision}`, BUNDLE_TTL_SEC, () =>
      this.repo.listAllTranslations(locale),
    );
  }

  /**
   * Full composed messages of a locale (fallback applied). Cached per
   * (locale, own revision, default revision) so a default-locale edit
   * invalidates dependent bundles too.
   */
  private async composedMessages(locale: string): Promise<Record<string, string>> {
    const def = await this.getDefaultLocale();
    if (locale === def) return this.rawMessages(locale);
    const [own, dflt] = await Promise.all([this.revision(locale), this.revision(def)]);
    return this.cache.wrap(`i18n:composed:${locale}:v${own}:d${dflt}`, BUNDLE_TTL_SEC, async () => {
      const [localeRaw, defaultRaw] = await Promise.all([
        this.rawMessages(locale),
        this.rawMessages(def),
      ]);
      return composeWithFallback(defaultRaw, localeRaw);
    });
  }

  /**
   * The public message bundle. Returns null when the locale is unknown or
   * inactive (the controller maps that to 404). `namespaces` filters by
   * first key segments; the version hashes the FILTERED entry set.
   */
  async getBundle(locale: string, namespaces?: string[]): Promise<MessageBundle | null> {
    const active = await this.getLanguages(true);
    if (!active.some((l) => l.code === locale)) return null;
    const messages = filterByNamespaces(await this.composedMessages(locale), namespaces ?? null);
    return { locale, version: computeBundleVersion(messages), messages };
  }

  /**
   * Server-side message lookup for later modules (mail/SMS templates,
   * notifications). Falls back to the default locale, then to the key
   * itself. Interpolates `{var}` placeholders.
   */
  async translate(
    locale: string,
    key: string,
    vars?: Record<string, string | number>,
  ): Promise<string> {
    const messages = await this.composedMessages(locale);
    const template = messages[key];
    if (template === undefined) return key;
    return interpolate(template, vars);
  }

  /** Called by the admin controller after EVERY language/translation write. */
  async invalidateLanguageList(): Promise<void> {
    await this.cache.del('i18n:langs:active');
    await this.cache.del('i18n:langs:all');
    await this.cache.del('i18n:default-lang');
  }

  async invalidateTranslations(locale: string): Promise<void> {
    await this.bumpRevision(locale);
  }

  /**
   * resolveLocale(req) — query `lang`, then the user's saved locale, then
   * the Accept-Language header, then the site default. Only ACTIVE
   * languages are accepted; region variants map to their base code.
   */
  async resolveLocale(candidates: {
    queryLang?: string | undefined;
    userLocale?: string | null | undefined;
    headerLocale?: string | null | undefined;
  }): Promise<string> {
    const active = await this.getLanguages(true);
    const activeCodes = new Set(active.map((l) => l.code));
    const ordered = [candidates.queryLang, candidates.userLocale, candidates.headerLocale];
    for (const candidate of ordered) {
      if (!candidate) continue;
      const base = candidate.split(',')[0]?.trim().split('-')[0]?.toLowerCase();
      if (base && activeCodes.has(base)) return base;
    }
    return this.getDefaultLocale();
  }

  /** App-level default locale (site default language row, fallback `fa`). */
  async defaultLocaleForGuests(): Promise<string> {
    void this.config;
    return this.getDefaultLocale();
  }
}
