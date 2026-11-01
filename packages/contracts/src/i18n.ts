import { z } from 'zod';
import { pageMetaSchema, pageQuerySchema } from './pagination.js';
import { localeCodeSchema } from './primitives.js';

/**
 * i18n contracts (B1.12). Languages live in the database; translations are
 * flat dot-key strings (`auth.login.title`) — NO HTML is allowed in values
 * (the only markup-like syntax is ICU-style `{var}` placeholders). Bundles
 * are composed server-side with fallback to the default locale.
 */

/**
 * Translation key: at least two dot-separated segments. First segment is the
 * namespace (`common`, `errors`, `auth.login.title` → namespace `auth`).
 */
export const i18nKeySchema = z
  .string()
  .regex(
    /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/,
    'key must be dot-separated with at least two segments (e.g. auth.login.title)',
  );
export type I18nKey = z.infer<typeof i18nKeySchema>;

export const languageDirSchema = z.enum(['rtl', 'ltr']);
export type LanguageDir = z.infer<typeof languageDirSchema>;

/** A language row as returned by the API. */
export const languageSchema = z
  .object({
    code: localeCodeSchema,
    nameNative: z.string().min(1).max(100),
    nameEn: z.string().min(1).max(100),
    dir: languageDirSchema,
    isDefault: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .strict();
export type Language = z.infer<typeof languageSchema>;

export const languageListResponseSchema = z.object({
  items: z.array(languageSchema),
});
export type LanguageListResponse = z.infer<typeof languageListResponseSchema>;

export const createLanguageBodySchema = z
  .object({
    code: localeCodeSchema,
    nameNative: z.string().min(1).max(100),
    nameEn: z.string().min(1).max(100),
    dir: languageDirSchema,
    sortOrder: z.number().int().min(0).max(10_000).default(100),
  })
  .strict();
export type CreateLanguageBody = z.infer<typeof createLanguageBodySchema>;

/**
 * `isDefault: true` switches the default atomically (previous default is
 * unset in the same transaction). The current default language cannot be
 * deactivated and `fa` can never be deactivated or deleted (server-side rules).
 */
export const updateLanguageBodySchema = z
  .object({
    nameNative: z.string().min(1).max(100).optional(),
    nameEn: z.string().min(1).max(100).optional(),
    dir: languageDirSchema.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type UpdateLanguageBody = z.infer<typeof updateLanguageBodySchema>;

export const translationEntrySchema = z
  .object({
    key: i18nKeySchema,
    value: z.string().max(5000),
  })
  .strict();
export type TranslationEntry = z.infer<typeof translationEntrySchema>;

export const upsertTranslationsBodySchema = z
  .object({
    locale: localeCodeSchema,
    entries: z.array(translationEntrySchema).min(1).max(500),
  })
  .strict();
export type UpsertTranslationsBody = z.infer<typeof upsertTranslationsBodySchema>;

/** sha1 over the sorted `key=value` lines, first 12 hex chars. */
export const bundleVersionSchema = z.string().regex(/^[0-9a-f]{12}$/);

export const messageBundleSchema = z
  .object({
    locale: localeCodeSchema,
    version: bundleVersionSchema,
    messages: z.record(z.string()),
  })
  .strict();
export type MessageBundle = z.infer<typeof messageBundleSchema>;

export const messagesQuerySchema = z
  .object({
    /** Comma-separated namespaces (first key segments), e.g. `common,errors`. */
    namespaces: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*(,[a-z][a-zA-Z0-9]*)*$/)
      .optional(),
  })
  .strict();
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

export const importTranslationsBodySchema = z
  .object({
    locale: localeCodeSchema,
    messages: z.record(z.string().max(5000)),
    mode: z.enum(['fill_missing', 'overwrite']),
  })
  .strict();
export type ImportTranslationsBody = z.infer<typeof importTranslationsBodySchema>;

export const importResultSchema = z
  .object({
    inserted: z.number().int().min(0),
    updated: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .strict();
export type ImportResult = z.infer<typeof importResultSchema>;

/** Admin translations list query (page-based). */
export const adminTranslationsQuerySchema = pageQuerySchema
  .extend({
    locale: localeCodeSchema,
    q: z.string().min(1).max(200).optional(),
    namespace: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/)
      .optional(),
    /** Only keys present in the default locale but missing in `locale`. */
    missing: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export type AdminTranslationsQuery = z.infer<typeof adminTranslationsQuerySchema>;

/** One row of the admin translations list; `defaultValue` is the reference from the default locale. */
export const adminTranslationRowSchema = z
  .object({
    key: z.string(),
    value: z.string().nullable(),
    defaultValue: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();
export type AdminTranslationRow = z.infer<typeof adminTranslationRowSchema>;

export const adminTranslationsListResponseSchema = z.object({
  items: z.array(adminTranslationRowSchema),
  meta: pageMetaSchema,
});
export type AdminTranslationsListResponse = z.infer<typeof adminTranslationsListResponseSchema>;

export const adminTranslationDeleteQuerySchema = z
  .object({
    locale: localeCodeSchema,
    key: i18nKeySchema,
  })
  .strict();
export type AdminTranslationDeleteQuery = z.infer<typeof adminTranslationDeleteQuerySchema>;
