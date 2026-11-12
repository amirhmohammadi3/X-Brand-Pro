'use client';

/**
 * Follows + feed API hooks (F5.2). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B5.2 contract schemas) and TanStack
 * Query via `useApiMutation`, so 4xx are never retried and server errors land
 * in the standard mapping.
 *
 * Cache strategy (mirrors the B5.2 storage invariants):
 * - `GET /follows/me` is keyed once per user and serves BOTH the account page
 *   and the membership probes of every follow button (there is no per-target
 *   status endpoint in B5.2 — membership derives from the two lists);
 * - `GET /feed` is keyed by (type tab, page, pageSize);
 * - every write (follow/unfollow, either kind) invalidates the WHOLE
 *   `qk.follows` subtree: the two follow lists change AND the feed's actor
 *   set changes the moment the caller follows someone new.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  feedResultSchema,
  followResultSchema,
  myFollowsResultSchema,
  type ActivityType,
  type FeedResult,
  type FollowResult,
  type MyFollowsResult,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** Feed page size for the F5.2 feed view (≤ 100 per the pagination contract). */
export const FEED_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `GET /follows/me` — the caller's followed users + businesses (newest
 * follows first). Authenticated-only endpoint: the query is enabled when the
 * caller passes `enabled=true` so anonymous surfaces never fire it.
 */
export function useMyFollows(enabled = true): {
  result: MyFollowsResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<MyFollowsResult>({
    queryKey: qk.follows.mine(),
    queryFn: async () => {
      const res = await apiFetch('/follows/me', myFollowsResultSchema);
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** `GET /feed` — one page of the caller's home feed, optionally type-filtered. */
export function useFeed(
  type: ActivityType | null,
  page: number,
  pageSize: number = FEED_PAGE_SIZE,
): {
  result: FeedResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<FeedResult>({
    queryKey: qk.follows.feed(type, page, pageSize),
    queryFn: async () => {
      const res = await apiFetch('/feed', feedResultSchema, {
        query: {
          page,
          pageSize,
          ...(type !== null ? { type } : {}),
        },
      });
      return res.data;
    },
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

// ---------------------------------------------------------------------------
// Writes — businesses
// ---------------------------------------------------------------------------

/** `POST /follows/businesses/:id` — 409 on double-follow, 404/422 target gates. */
export function useFollowBusiness() {
  const queryClient = useQueryClient();
  return useApiMutation<FollowResult, string>(
    async (businessId) => {
      const res = await apiFetch(`/follows/businesses/${businessId}`, followResultSchema, {
        method: 'POST',
      });
      return res.data;
    },
    {
      onSettled: () => {
        // The follow lists change AND the feed's actor set grows.
        void queryClient.invalidateQueries({ queryKey: qk.follows.all() });
      },
    },
  );
}

/** `DELETE /follows/businesses/:id` — idempotent unfollow. */
export function useUnfollowBusiness() {
  const queryClient = useQueryClient();
  return useApiMutation<FollowResult, string>(
    async (businessId) => {
      const res = await apiFetch(`/follows/businesses/${businessId}`, followResultSchema, {
        method: 'DELETE',
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.follows.all() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Writes — users
// ---------------------------------------------------------------------------

/** `POST /follows/users/:id` — 422 self-follow, 404 blocked target. */
export function useFollowUser() {
  const queryClient = useQueryClient();
  return useApiMutation<FollowResult, string>(
    async (userId) => {
      const res = await apiFetch(`/follows/users/${userId}`, followResultSchema, {
        method: 'POST',
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.follows.all() });
      },
    },
  );
}

/** `DELETE /follows/users/:id` — idempotent unfollow. */
export function useUnfollowUser() {
  const queryClient = useQueryClient();
  return useApiMutation<FollowResult, string>(
    async (userId) => {
      const res = await apiFetch(`/follows/users/${userId}`, followResultSchema, {
        method: 'DELETE',
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.follows.all() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Local re-exports (schema .parse guards above already import the types).
// ---------------------------------------------------------------------------

// (no module-level statements below this line)
