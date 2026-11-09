import { useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminTranslationsListResponseSchema,
  languageSchema,
  upsertTranslationsBodySchema,
  type AdminTranslationsListResponse,
  type CreateLanguageBody,
  type Language,
  type UpdateLanguageBody,
  type UpsertTranslationsBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { qk } from './qk';
import { useApiMutation } from './use-api-mutation';

/**
 * Admin i18n hooks (F2.3) — languages and the translation editor against
 * the `i18n.manage` admin API (B1.12). Language mutations invalidate the
 * language list (which the public locale switcher also consumes via a
 * different key, refreshed on its own staleTime); translation upserts
 * invalidate the editor page for that locale.
 */

const languageListSchema = z.object({ items: z.array(languageSchema) });
const okBooleanSchema = z.object({ ok: z.boolean() });
const deletedSchema = z.object({ deleted: z.boolean() });

export interface AdminTranslationsFilter {
  q?: string;
  namespace?: string;
  missing?: boolean;
  page: number;
  pageSize: number;
}

/** `GET /admin/i18n/languages` — every language, active or not. */
export function useAdminLanguages() {
  return useQuery<Language[]>({
    queryKey: qk.admin.i18n.languages(),
    queryFn: async () => {
      const result = await apiFetch('/admin/i18n/languages', languageListSchema);
      return result.data.items;
    },
    staleTime: 15_000,
  });
}

export function useCreateLanguage(): UseMutationResult<Language, Error, CreateLanguageBody> {
  const queryClient = useQueryClient();
  return useApiMutation<Language, CreateLanguageBody>(
    async (body) => {
      const result = await apiFetch('/admin/i18n/languages', languageSchema, {
        method: 'POST',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => invalidate(queryClient, [qk.admin.i18n.languages()]),
    },
  );
}

export function useUpdateLanguage(): UseMutationResult<
  Language,
  Error,
  { code: string; body: UpdateLanguageBody }
> {
  const queryClient = useQueryClient();
  return useApiMutation<Language, { code: string; body: UpdateLanguageBody }>(
    async ({ code, body }) => {
      const result = await apiFetch(
        `/admin/i18n/languages/${encodeURIComponent(code)}`,
        languageSchema,
        { method: 'PATCH', body },
      );
      return result.data;
    },
    {
      onSuccess: () =>
        invalidate(queryClient, [qk.admin.i18n.languages(), qk.admin.i18n.translationsAll()]),
    },
  );
}

export function useDeleteLanguage(): UseMutationResult<{ deleted: boolean }, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<{ deleted: boolean }, string>(
    async (code) => {
      const result = await apiFetch(
        `/admin/i18n/languages/${encodeURIComponent(code)}`,
        deletedSchema,
        { method: 'DELETE' },
      );
      return result.data;
    },
    {
      onSuccess: () => invalidate(queryClient, [qk.admin.i18n.languages()]),
    },
  );
}

/** `GET /admin/i18n/translations` — one page of a locale's keys. */
export function useAdminTranslations(locale: string, filter: AdminTranslationsFilter) {
  return useQuery<AdminTranslationsListResponse>({
    queryKey: qk.admin.i18n.translations(locale, filter),
    queryFn: async () => {
      const result = await apiFetch(
        '/admin/i18n/translations',
        adminTranslationsListResponseSchema,
        {
          query: {
            locale,
            page: filter.page,
            pageSize: filter.pageSize,
            ...(filter.q && filter.q.trim() ? { q: filter.q.trim() } : {}),
            ...(filter.namespace ? { namespace: filter.namespace } : {}),
            ...(filter.missing ? { missing: 'true' } : {}),
          },
        },
      );
      return result.data;
    },
    enabled: locale.length > 0,
    staleTime: 10_000,
  });
}

/** `PUT /admin/i18n/translations` — upsert up to 500 entries at once. */
export function useUpsertTranslations(
  locale: string,
): UseMutationResult<{ saved: number }, Error, UpsertTranslationsBody['entries']> {
  const queryClient = useQueryClient();
  return useApiMutation<{ saved: number }, UpsertTranslationsBody['entries']>(
    async (entries) => {
      const body = upsertTranslationsBodySchema.parse({ locale, entries });
      await apiFetch('/admin/i18n/translations', okBooleanSchema, {
        method: 'PUT',
        body,
      });
      // The API answers {ok:true}; the meaningful count for the toast is the
      // number of entries we sent.
      return { saved: entries.length };
    },
    {
      onSuccess: () => invalidate(queryClient, [qk.admin.i18n.translationsAll()]),
    },
  );
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: ReadonlyArray<readonly unknown[]>,
): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
}
