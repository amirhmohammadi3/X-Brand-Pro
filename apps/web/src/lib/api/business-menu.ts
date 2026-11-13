'use client';

/**
 * Business menu API hooks (F7.3). The owner dashboard's menu editor reads the
 * menu (`GET /businesses/:id/menu`) and replaces it atomically
 * (`PUT /businesses/:id/menu` — the payload snapshot BECOMES the menu, rows
 * recreated, ids server-issued). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B2.8 contracts).
 *
 * Cache strategy: `useBusinessMenu(id)` is keyed per business; a replace
 * invalidates the menu key AND the business detail (the page aggregate embeds
 * the menu).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  menuResponseSchema,
  replaceMenuBodySchema,
  type MenuResponse,
  type ReplaceMenuBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** `GET /businesses/:id/menu` — sections + items. */
export function useBusinessMenu(businessId: string | null | undefined): {
  menu: MenuResponse | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<MenuResponse>({
    queryKey: qk.businesses.menu(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch(`/businesses/${businessId as string}/menu`, menuResponseSchema);
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { menu: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `PUT /businesses/:id/menu` — full-menu replace (the snapshot becomes the menu). */
export function useReplaceMenu(businessId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (body: ReplaceMenuBody) => {
      void replaceMenuBodySchema.parse(body);
      const result = await apiFetch(`/businesses/${businessId}/menu`, menuResponseSchema, {
        method: 'PUT',
        body,
      });
      return result.data;
    },
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: qk.businesses.menu(businessId) });
        void queryClient.invalidateQueries({ queryKey: qk.businesses.detail(businessId) });
      },
    },
  );
}
