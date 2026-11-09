import { useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  activeThemeSchema,
  adminSettingSchema,
  themePreviewSchema,
  type ActiveTheme,
  type AdminSetting,
  type ThemePreview,
} from '@app/contracts';
import { apiFetch } from './client';
import { qk } from './qk';
import { useApiMutation } from './use-api-mutation';

/**
 * Admin theme + settings hooks (F2.4) — the active-pack switch over the
 * B1.13 `theme.manage` API and the settings registry editor over the
 * B1.1/B1.11 `settings.manage` API. Switching the active pack invalidates
 * the packs list (its `isActive` badge) — the public site's SSR theme is
 * cached under its own key/tag and revalidates on its own schedule.
 */

const themePacksSchema = z.object({ items: z.array(themePreviewSchema) });
const groupedSettingsSchema = z.object({
  groups: z.record(z.string(), z.array(adminSettingSchema)),
});

/** `GET /theme/packs` — public endpoint, previews with `isActive`. */
export function useThemePacks() {
  return useQuery<ThemePreview[]>({
    queryKey: qk.admin.theme.packs(),
    queryFn: async () => {
      const result = await apiFetch('/theme/packs', themePacksSchema);
      return result.data.items;
    },
    staleTime: 15_000,
  });
}

/** `PUT /admin/theme/active` — switch the site-wide active pack. */
export function useSetActiveTheme(): UseMutationResult<ActiveTheme, Error, string> {
  const queryClient = useQueryClient();
  return useApiMutation<ActiveTheme, string>(
    async (packId) => {
      const result = await apiFetch('/admin/theme/active', activeThemeSchema, {
        method: 'PUT',
        body: { packId },
      });
      return result.data;
    },
    {
      onSuccess: () => invalidate(queryClient, [qk.admin.theme.packs()]),
    },
  );
}

export type GroupedSettings = { groups: Record<string, AdminSetting[]> };

/** `GET /admin/settings` — every registry key grouped, secrets masked. */
export function useAdminSettings() {
  return useQuery<GroupedSettings>({
    queryKey: qk.admin.settings.all(),
    queryFn: async () => {
      const result = await apiFetch('/admin/settings', groupedSettingsSchema);
      return result.data;
    },
    staleTime: 15_000,
  });
}

export function useUpdateSetting(): UseMutationResult<
  AdminSetting,
  Error,
  { key: string; value: unknown; clear?: boolean }
> {
  const queryClient = useQueryClient();
  return useApiMutation<AdminSetting, { key: string; value: unknown; clear?: boolean }>(
    async ({ key, value, clear }) => {
      const result = await apiFetch(
        `/admin/settings/${encodeURIComponent(key)}`,
        adminSettingSchema,
        {
          method: 'PUT',
          body: clear === true ? { value: '', clear: true } : { value },
        },
      );
      return result.data;
    },
    {
      onSuccess: () => invalidate(queryClient, [qk.admin.settings.all()]),
    },
  );
}

const SETTING_KEY_RE = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

/** Wire-format guard for the settings key path segment (defense in depth —
 *  the server re-validates with the same schema). */
export function isValidSettingKey(key: string): boolean {
  return SETTING_KEY_RE.test(key);
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  keys: ReadonlyArray<readonly unknown[]>,
): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
}
