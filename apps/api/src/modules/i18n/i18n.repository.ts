import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  languages,
  translations,
  type LanguageRow,
  type TranslationRow,
} from '../../db/schema/i18n.js';
import type { TranslationEntry } from '@app/contracts';

export const I18N_REPOSITORY = Symbol('I18N_REPOSITORY');

export interface TranslationFilters {
  q?: string;
  namespace?: string;
  missing: boolean;
  page: number;
  pageSize: number;
}

export interface AdminTranslationsPage {
  items: Array<{
    key: string;
    value: string | null;
    defaultValue: string | null;
    updatedAt: Date | null;
  }>;
  total: number;
}

export interface I18nRepositoryLike {
  listLanguages(activeOnly: boolean): Promise<LanguageRow[]>;
  findLanguage(code: string): Promise<LanguageRow | null>;
  findDefaultLanguage(): Promise<LanguageRow | null>;
  createLanguage(row: {
    code: string;
    nameNative: string;
    nameEn: string;
    dir: 'rtl' | 'ltr';
    sortOrder: number;
  }): Promise<LanguageRow>;
  updateLanguage(
    code: string,
    patch: Partial<
      Pick<LanguageRow, 'nameNative' | 'nameEn' | 'dir' | 'isActive' | 'isDefault' | 'sortOrder'>
    >,
  ): Promise<LanguageRow | null>;
  deleteLanguage(code: string): Promise<boolean>;
  listAllTranslations(locale: string): Promise<Record<string, string>>;
  listTranslationsPage(locale: string, filters: TranslationFilters): Promise<AdminTranslationsPage>;
  upsertTranslations(
    locale: string,
    entries: TranslationEntry[],
    updatedBy: string | null,
  ): Promise<void>;
  deleteTranslation(locale: string, key: string): Promise<boolean>;
}

/**
 * Drizzle-backed i18n repository (B1.12). All queries for the i18n domain
 * live here; the service never touches the db client directly.
 */
@Injectable()
export class I18nRepository implements I18nRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async listLanguages(activeOnly: boolean): Promise<LanguageRow[]> {
    const base = this.client.db.select().from(languages);
    const rows = activeOnly
      ? await base
          .where(eq(languages.isActive, true))
          .orderBy(asc(languages.sortOrder), asc(languages.code))
      : await base.orderBy(asc(languages.sortOrder), asc(languages.code));
    return rows;
  }

  async findLanguage(code: string): Promise<LanguageRow | null> {
    const rows = await this.client.db
      .select()
      .from(languages)
      .where(eq(languages.code, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async findDefaultLanguage(): Promise<LanguageRow | null> {
    const rows = await this.client.db
      .select()
      .from(languages)
      .where(eq(languages.isDefault, true))
      .limit(1);
    return rows[0] ?? null;
  }

  async createLanguage(row: {
    code: string;
    nameNative: string;
    nameEn: string;
    dir: 'rtl' | 'ltr';
    sortOrder: number;
  }): Promise<LanguageRow> {
    // New languages start INACTIVE until an admin activates them (B1.12).
    const inserted = await this.client.db
      .insert(languages)
      .values({ ...row, isDefault: false, isActive: false })
      .onConflictDoNothing({ target: languages.code })
      .returning();
    if (inserted[0]) return inserted[0];
    throw new Error(`language already exists: ${row.code}`);
  }

  async updateLanguage(
    code: string,
    patch: Partial<
      Pick<LanguageRow, 'nameNative' | 'nameEn' | 'dir' | 'isActive' | 'isDefault' | 'sortOrder'>
    >,
  ): Promise<LanguageRow | null> {
    return this.client.db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        // Atomic default switch: unset the previous default first — the
        // partial unique index would reject two defaults otherwise.
        await tx.update(languages).set({ isDefault: false }).where(eq(languages.isDefault, true));
      }
      const rows = await tx
        .update(languages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(languages.code, code))
        .returning();
      return rows[0] ?? null;
    });
  }

  async deleteLanguage(code: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(languages)
      .where(eq(languages.code, code))
      .returning({ code: languages.code });
    return rows.length > 0;
  }

  async listAllTranslations(locale: string): Promise<Record<string, string>> {
    const rows = await this.client.db
      .select({ key: translations.key, value: translations.value })
      .from(translations)
      .where(eq(translations.locale, locale));
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  async listTranslationsPage(
    locale: string,
    filters: TranslationFilters,
  ): Promise<AdminTranslationsPage> {
    if (filters.missing) {
      // Missing keys: present in the default locale, absent in `locale`.
      // Key sets are small at this scale — set difference in memory keeps
      // the SQL simple and the behaviour exact.
      const defaults = await this.client.db
        .select({ key: translations.key, value: translations.value })
        .from(translations)
        .innerJoin(languages, eq(languages.code, translations.locale))
        .where(eq(languages.isDefault, true))
        .orderBy(asc(translations.key));
      const localeRows = await this.client.db
        .select({ key: translations.key })
        .from(translations)
        .where(eq(translations.locale, locale));
      const present = new Set(localeRows.map((r) => r.key));
      let items = defaults
        .filter((r) => !present.has(r.key))
        .map((r) => ({
          key: r.key,
          value: null as string | null,
          defaultValue: r.value as string | null,
          updatedAt: null as Date | null,
        }));
      items = applyAdminFilters(items, filters);
      return {
        items: items.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
        total: items.length,
      };
    }

    const conditions = [eq(translations.locale, locale)];
    if (filters.q) {
      const needle = `%${filters.q}%`;
      const match = or(ilike(translations.key, needle), ilike(translations.value, needle));
      if (match) conditions.push(match);
    }
    if (filters.namespace) {
      conditions.push(ilike(translations.key, `${filters.namespace}.%`));
    }
    const where = and(...conditions);

    const rows = await this.client.db
      .select()
      .from(translations)
      .where(where)
      .orderBy(asc(translations.key))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
    const totalRows = await this.client.db
      .select({ count: sql<number>`count(*)::int` })
      .from(translations)
      .where(where);

    const items = rows.map((r: TranslationRow) => ({
      key: r.key,
      value: r.value,
      defaultValue: null as string | null,
      updatedAt: r.updatedAt,
    }));
    return { items, total: totalRows[0]?.count ?? 0 };
  }

  async upsertTranslations(
    locale: string,
    entries: TranslationEntry[],
    updatedBy: string | null,
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.client.db
      .insert(translations)
      .values(entries.map((e) => ({ locale, key: e.key, value: e.value, updatedBy })))
      .onConflictDoUpdate({
        target: [translations.locale, translations.key],
        set: {
          value: sql`excluded.value`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: new Date(),
        },
      });
  }

  async deleteTranslation(locale: string, key: string): Promise<boolean> {
    const rows = await this.client.db
      .delete(translations)
      .where(and(eq(translations.locale, locale), eq(translations.key, key)))
      .returning({ key: translations.key });
    return rows.length > 0;
  }
}

/** In-memory q / namespace filter for the missing-keys listing. */
function applyAdminFilters<T extends { key: string }>(
  items: T[],
  filters: TranslationFilters,
): T[] {
  let out = items;
  if (filters.namespace) {
    out = out.filter((i) => i.key.startsWith(`${filters.namespace}.`));
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    out = out.filter(
      (i) =>
        i.key.toLowerCase().includes(needle) ||
        (i as { defaultValue?: string | null }).defaultValue?.toLowerCase().includes(needle),
    );
  }
  return out;
}
