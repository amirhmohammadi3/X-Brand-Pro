'use client';

/**
 * Notifications API hooks (F5.3). Every JSON call goes through the shared
 * `apiFetch` (envelope-validated with the B5.3 contract schemas) and TanStack
 * Query via `useApiMutation`.
 *
 * Cache strategy:
 * - the header bell polls a deliberately CHEAP probe (page size 1) keyed
 *   `qk.notifications.unread()` every 60 s; the same cache entry carries the
 *   `unread` total of every inbox fetch, so opening the center refreshes the
 *   bell for free (the probe key is a distinct entry — mark-read invalidates
 *   the whole `qk.notifications` subtree to move both at once);
 * - the preferences matrix is keyed once per user; a channel toggle PUTs the
 *   partial merge and invalidates the matrix (the server returns the merged
 *   view, so the UI never guesses the effective state).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  markNotificationsReadBodySchema,
  markNotificationsReadResultSchema,
  notificationInboxResultSchema,
  notificationPreferencesResultSchema,
  updateNotificationPreferenceBodySchema,
  type MarkNotificationsReadBody,
  type MarkNotificationsReadResult,
  type NotificationInboxResult,
  type NotificationPreferencesResult,
  type UpdateNotificationPreferenceBody,
} from '@app/contracts';
import { apiFetch } from './client';
import { useApiMutation } from './use-api-mutation';
import { qk } from './qk';

/** Inbox page size for the F5.3 center (≤ 100 per the pagination contract). */
export const NOTIFICATIONS_PAGE_SIZE = 10;

/** Bell poll interval (ms) — 60 s keeps the badge honest without chatter. */
export const UNREAD_POLL_MS = 60_000;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `GET /notifications/me/inbox` — one page, newest first, with the unread
 * total. Enabled only for authenticated callers.
 */
export function useNotificationInbox(
  page: number,
  pageSize: number = NOTIFICATIONS_PAGE_SIZE,
  enabled = true,
): {
  result: NotificationInboxResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<NotificationInboxResult>({
    queryKey: qk.notifications.inbox(page, pageSize),
    queryFn: async () => {
      const res = await apiFetch('/notifications/me/inbox', notificationInboxResultSchema, {
        query: { page, pageSize },
      });
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/**
 * The cheap unread probe the header bell polls: inbox page 1 @ size 1 is the
 * smallest possible read and still carries the authoritative `unread` total.
 */
export function useUnreadCount(
  enabled: boolean,
  pollMs = UNREAD_POLL_MS,
): {
  unread: number;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<NotificationInboxResult>({
    queryKey: qk.notifications.unread(),
    queryFn: async () => {
      const res = await apiFetch('/notifications/me/inbox', notificationInboxResultSchema, {
        query: { page: 1, pageSize: 1 },
      });
      return res.data;
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? pollMs : false,
  });
  return {
    unread: query.data?.unread ?? 0,
    isPending: query.isPending,
    error: query.error,
  };
}

/** `GET /notifications/me/preferences` — the merged channel matrix (+ overrides). */
export function useNotificationPreferences(enabled = true): {
  result: NotificationPreferencesResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<NotificationPreferencesResult>({
    queryKey: qk.notifications.preferences(),
    queryFn: async () => {
      const res = await apiFetch(
        '/notifications/me/preferences',
        notificationPreferencesResultSchema,
      );
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * `PUT /notifications/me/preferences` — partial channel merge for one event
 * (the server keeps the untouched channels of the existing override row).
 */
export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useApiMutation<NotificationPreferencesResult, { body: UpdateNotificationPreferenceBody }>(
    async ({ body }) => {
      const res = await apiFetch(
        '/notifications/me/preferences',
        notificationPreferencesResultSchema,
        {
          method: 'PUT',
          body: updateNotificationPreferenceBodySchema.parse(body),
        },
      );
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.notifications.preferences() });
      },
    },
  );
}

/**
 * `POST /notifications/me/read` — mark explicit ids OR everything unread.
 * Invalidates the whole notifications subtree: the inbox pages re-render
 * their read/unread styling and the bell badge drops immediately.
 */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useApiMutation<MarkNotificationsReadResult, MarkNotificationsReadBody>(
    async (body) => {
      const res = await apiFetch('/notifications/me/read', markNotificationsReadResultSchema, {
        method: 'POST',
        body: markNotificationsReadBodySchema.parse(body),
      });
      return res.data;
    },
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: qk.notifications.all() });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Local re-exports (schema .parse guards above already import the types).
// ---------------------------------------------------------------------------

// (no module-level statements below this line)
