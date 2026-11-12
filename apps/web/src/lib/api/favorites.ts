'use client';

/**
 * Favorites API hooks (F5.1). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B5.1 contract schemas) and TanStack
 * Query via `useApiMutation`, so 4xx are never retried and server field errors
 * land in the standard `fieldErrors(error)` map.
 *
 * Cache strategy (mirrors the B5.1 storage invariants):
 * - the lists index (`GET /favorites/me`) is keyed once per user; every write
 *   that changes a list's name/count/shape invalidates the whole index — a
 *   heart-on never leaves a stale count on the lists page;
 * - the per-list items page is keyed by (listId, page, pageSize); moving an
 *   item between lists invalidates BOTH the source and target pages plus the
 *   lists index (counts move with the row);
 * - the heart probe (`GET /favorites/me/check?businessId=`) is keyed by
 *   businessId; a heart-on/off invalidates it alongside the lists index so the
 *   toggle flips immediately and the default list's count tracks it.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addFavoriteItemBodySchema,
  createFavoriteListBodySchema,
  deleteFavoriteItemResultSchema,
  deleteFavoriteListResultSchema,
  favoriteItemSchema,
  favoriteListItemsResultSchema,
  favoriteListSummarySchema,
  favoriteStatusResultSchema,
  myFavoriteListsResultSchema,
  updateFavoriteItemBodySchema,
  updateFavoriteListBodySchema,
  FAVORITE_DEFAULT_LIST_NAME,
  type AddFavoriteItemBody,
  type CreateFavoriteListBody,
  type DeleteFavoriteItemResult,
  type DeleteFavoriteListResult,
  type FavoriteItem,
  type FavoriteListItemsResult,
  type FavoriteListSummary,
  type FavoriteStatusResult,
  type MyFavoriteListsResult,
  type UpdateFavoriteItemBody,
  type UpdateFavoriteListBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** The default list is shown under this i18n label, not its stored name. */
export { FAVORITE_DEFAULT_LIST_NAME };

/** Default items-page size for the list detail view (kept ≤ 100 per contract). */
export const FAVORITES_PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /favorites/me` — the caller's lists (default first, then newest). */
export function useFavoriteLists(): {
  lists: FavoriteListSummary[] | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<MyFavoriteListsResult>({
    queryKey: qk.favorites.lists(),
    queryFn: async () => {
      const result = await apiFetch('/favorites/me', myFavoriteListsResultSchema);
      return result.data;
    },
    staleTime: 30_000,
  });
  return {
    lists: query.data?.lists ?? null,
    isPending: query.isPending,
    error: query.error,
  };
}

/**
 * `GET /favorites/me/check?businessId=…` — the heart state, one probe. The
 * query is enabled only when a businessId is supplied so the
 * `FavoriteToggle` can mount on a business page before the id resolves.
 */
export function useFavoriteStatus(businessId: string | null | undefined): {
  status: FavoriteStatusResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<FavoriteStatusResult>({
    queryKey: qk.favorites.status(businessId ?? ''),
    queryFn: async () => {
      const result = await apiFetch('/favorites/me/check', favoriteStatusResultSchema, {
        query: { businessId: businessId as string },
      });
      return result.data;
    },
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });
  return { status: query.data ?? null, isPending: query.isPending, error: query.error };
}

/**
 * `GET /favorites/lists/:id/items` — saved businesses as full cards, page
 * based (newest first). Disabled when no listId is selected yet.
 */
export function useFavoriteListItems(
  listId: string | null | undefined,
  page: number,
  pageSize: number = FAVORITES_PAGE_SIZE,
): {
  result: FavoriteListItemsResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<FavoriteListItemsResult>({
    queryKey: qk.favorites.listItems(listId ?? '', page, pageSize),
    queryFn: async () => {
      const result = await apiFetch(
        `/favorites/lists/${listId}/items`,
        favoriteListItemsResultSchema,
        { query: { page, pageSize } },
      );
      return result.data;
    },
    enabled: Boolean(listId),
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

// ---------------------------------------------------------------------------
// Writes — lists
// ---------------------------------------------------------------------------

/** `POST /favorites/lists` — a new named list. */
export function useCreateFavoriteList() {
  const queryClient = useQueryClient();
  return useApiMutation<FavoriteListSummary, CreateFavoriteListBody>(
    async (body) => {
      const result = await apiFetch('/favorites/lists', favoriteListSummarySchema, {
        method: 'POST',
        body: createFavoriteListBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
      },
    },
  );
}

/** `PATCH /favorites/lists/:id` — rename (owner-only; default list allowed). */
export function useRenameFavoriteList() {
  const queryClient = useQueryClient();
  return useApiMutation<FavoriteListSummary, { id: string; body: UpdateFavoriteListBody }>(
    async ({ id, body }) => {
      const result = await apiFetch(`/favorites/lists/${id}`, favoriteListSummarySchema, {
        method: 'PATCH',
        body: updateFavoriteListBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
      },
    },
  );
}

/** `DELETE /favorites/lists/:id` — the default list is undeletable (422). */
export function useDeleteFavoriteList() {
  const queryClient = useQueryClient();
  return useApiMutation<DeleteFavoriteListResult, string>(
    async (id) => {
      const result = await apiFetch(`/favorites/lists/${id}`, deleteFavoriteListResultSchema, {
        method: 'DELETE',
      });
      return result.data;
    },
    {
      onSettled: () => {
        // The whole lists index + every list's items page (counts and
        // memberships cascade) must be refetched.
        void queryClient.invalidateQueries({ queryKey: qk.favorites.all() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Writes — items
// ---------------------------------------------------------------------------

/**
 * `POST /favorites/items` — the heart-on shortcut: saves into the caller's
 * default list (created lazily server-side). Invalidates the lists index (the
 * default count moves) and the per-business probe.
 */
export function useAddFavoriteToDefault() {
  const queryClient = useQueryClient();
  return useApiMutation<FavoriteItem, AddFavoriteItemBody>(
    async (body) => {
      const result = await apiFetch('/favorites/items', favoriteItemSchema, {
        method: 'POST',
        body: addFavoriteItemBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSuccess: (item, variables) => {
        // Optimistically flip the probe so the heart fills before the refetch.
        queryClient.setQueryData<FavoriteStatusResult>(qk.favorites.status(variables.businessId), {
          businessId: variables.businessId,
          favorited: true,
          listId: item.listId,
          listName: null,
          itemId: item.id,
        });
      },
      onSettled: (_data, _error, variables) => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
        void queryClient.invalidateQueries({
          queryKey: qk.favorites.status(variables.businessId),
        });
      },
    },
  );
}

/** `POST /favorites/lists/:id/items` — save into a named list. */
export function useAddFavoriteItem() {
  const queryClient = useQueryClient();
  return useApiMutation<FavoriteItem, { listId: string; body: AddFavoriteItemBody }>(
    async ({ listId, body }) => {
      const result = await apiFetch(`/favorites/lists/${listId}/items`, favoriteItemSchema, {
        method: 'POST',
        body: addFavoriteItemBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSettled: (_data, _error, variables) => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
        void queryClient.invalidateQueries({
          queryKey: qk.favorites.status(variables.body.businessId),
        });
        // The target list's first items page is the one that changes — the
        // whole listId subtree is cheap to refetch.
        void queryClient.invalidateQueries({
          queryKey: qk.favorites.listItemsAll(variables.listId),
        });
      },
    },
  );
}

/**
 * `PATCH /favorites/items/:id` — move between lists and/or edit the note.
 * Invalidates the source and target lists' items plus the lists index (counts
 * move with the row) and the probe (listName/listId may change).
 */
export function useUpdateFavoriteItem() {
  const queryClient = useQueryClient();
  return useApiMutation<
    FavoriteItem,
    { itemId: string; businessId: string; body: UpdateFavoriteItemBody }
  >(
    async ({ itemId, body }) => {
      const result = await apiFetch(`/favorites/items/${itemId}`, favoriteItemSchema, {
        method: 'PATCH',
        body: updateFavoriteItemBodySchema.parse(body),
      });
      return result.data;
    },
    {
      onSettled: (_data, _error, variables) => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
        void queryClient.invalidateQueries({
          queryKey: qk.favorites.status(variables.businessId),
        });
        // listId is unknown to the caller after a move (the patch carried the
        // target, not the source) — refresh every items page to be safe. The
        // lists() key is a prefix of every list-items key, so this one
        // invalidation covers the index AND all items pages.
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
      },
    },
  );
}

/** `DELETE /favorites/items/:id` — the heart-off half. */
export function useRemoveFavoriteItem() {
  const queryClient = useQueryClient();
  return useApiMutation<DeleteFavoriteItemResult, { itemId: string; businessId: string }>(
    async ({ itemId }) => {
      const result = await apiFetch(`/favorites/items/${itemId}`, deleteFavoriteItemResultSchema, {
        method: 'DELETE',
      });
      return result.data;
    },
    {
      onSuccess: (_data, variables) => {
        // Optimistically clear the probe so the heart empties before the refetch.
        queryClient.setQueryData<FavoriteStatusResult>(qk.favorites.status(variables.businessId), {
          businessId: variables.businessId,
          favorited: false,
          listId: null,
          listName: null,
          itemId: null,
        });
      },
      onSettled: (_data, _error, variables) => {
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
        void queryClient.invalidateQueries({
          queryKey: qk.favorites.status(variables.businessId),
        });
        // Same prefix trick as the move: lists() covers the index + every
        // items page in one shot.
        void queryClient.invalidateQueries({ queryKey: qk.favorites.lists() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Local re-exports (schema .parse guards above already import the types).
// ---------------------------------------------------------------------------

// (no module-level statements below this line)
