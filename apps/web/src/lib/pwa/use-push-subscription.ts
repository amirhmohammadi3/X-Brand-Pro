'use client';

/**
 * Push subscription hook (F5.4). Wires the browser Push API to the B5.4
 * backend:
 *   - the VAPID PUBLIC key is read from `GET /settings/public` (key
 *     `push.vapid.publicKey`, registered `public: true` in the settings
 *     registry) — the PRIVATE key never ships to the browser;
 *   - `subscribe()` calls `pushManager.subscribe` with the VAPID key, then
 *     POSTs the resulting `PushSubscription` (endpoint + p256dh + auth +
 *     userAgent) to `/notifications/me/push/subscriptions`;
 *   - `remove(id)` DELETEs one device row (sign-out / device cleanup);
 *   - `devices()` lists the caller's saved subscriptions (keys are never
 *     echoed back — the contract schema strips them).
 *
 * Failures are returned as `{ ok: false, error }` rather than thrown so the
 * UI can render a localized message; the hook is the only place push errors
 * are caught, keeping the preferences page logic linear.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';
import {
  createPushSubscriptionBodySchema,
  deletePushSubscriptionResultSchema,
  pushSubscriptionItemSchema,
  pushSubscriptionsResultSchema,
  type CreatePushSubscriptionBody,
  type DeletePushSubscriptionResult,
  type PushSubscriptionItem,
  type PushSubscriptionsResult,
} from '@app/contracts';
import { apiFetch } from '../api/client';
import { qk } from '../api/qk';

/** The shape of the public settings blob filtered to the VAPID key. */
const vapidSettingsSchema = z.object({
  'push.vapid.publicKey': z.string(),
});

/** Decoded Base64 URL-safe → Uint8Array (VAPID keys ship Base64URL-safe). */
export function base64UrlToBytes(base64Url: string): Uint8Array {
  const padded = base64Url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type PushSubscribeOutcome =
  | { ok: true; subscriptionId: string }
  | {
      ok: false;
      error: 'unsupported' | 'no_vapid' | 'denied' | 'network' | 'unknown';
    };

/** Read the VAPID public key from the public settings blob. */
async function fetchVapidPublicKey(): Promise<string | null> {
  const res = await apiFetch('/settings/public', vapidSettingsSchema, { query: {} });
  const key = res.data['push.vapid.publicKey'];
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** The registered devices list (`GET /notifications/me/push/subscriptions`). */
export function usePushDevices(enabled: boolean): {
  result: PushSubscriptionsResult | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<PushSubscriptionsResult>({
    queryKey: qk.notifications.pushDevices(),
    queryFn: async () => {
      const res = await apiFetch(
        '/notifications/me/push/subscriptions',
        pushSubscriptionsResultSchema,
      );
      return res.data;
    },
    enabled,
    staleTime: 30_000,
  });
  return { result: query.data ?? null, isPending: query.isPending, error: query.error };
}

/** The single object every F5.4 surface (settings toggle, banner) calls. */
export function usePushSubscription(registration: ServiceWorkerRegistration | null): {
  subscribe: () => Promise<PushSubscribeOutcome>;
  remove: (id: string) => Promise<DeletePushSubscriptionResult | null>;
} {
  const queryClient = useQueryClient();

  const subscribe = useCallback(async (): Promise<PushSubscribeOutcome> => {
    if (typeof window === 'undefined' || !('PushManager' in window)) {
      return { ok: false, error: 'unsupported' };
    }
    if (!registration) return { ok: false, error: 'unsupported' };

    let vapid: string | null;
    try {
      vapid = await fetchVapidPublicKey();
    } catch {
      return { ok: false, error: 'network' };
    }
    if (!vapid) return { ok: false, error: 'no_vapid' };
    if (Notification.permission === 'denied') return { ok: false, error: 'denied' };

    let permission: NotificationPermission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        return { ok: false, error: 'denied' };
      }
    }
    if (permission !== 'granted') return { ok: false, error: 'denied' };

    let sub: PushSubscription;
    try {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapid),
      });
    } catch {
      return { ok: false, error: 'denied' };
    }

    // `PushSubscription.keys` is part of the W3C Push API but missing from
    // some older lib.dom typings; cast through the minimal shape we need.
    const keys = (
      sub as PushSubscription & {
        keys?: { p256dh?: string; auth?: string };
      }
    ).keys;
    if (!keys?.p256dh || !keys?.auth) return { ok: false, error: 'unknown' };

    const body: CreatePushSubscriptionBody = createPushSubscriptionBodySchema.parse({
      endpoint: sub.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : undefined,
    });

    try {
      const res = await apiFetch<PushSubscriptionItem, CreatePushSubscriptionBody>(
        '/notifications/me/push/subscriptions',
        pushSubscriptionItemSchema,
        { method: 'POST', body },
      );
      void queryClient.invalidateQueries({ queryKey: qk.notifications.pushDevices() });
      return { ok: true, subscriptionId: res.data.id };
    } catch {
      return { ok: false, error: 'network' };
    }
  }, [registration, queryClient]);

  const remove = useCallback(
    async (id: string): Promise<DeletePushSubscriptionResult | null> => {
      try {
        const res = await apiFetch(
          `/notifications/me/push/subscriptions/${encodeURIComponent(id)}`,
          deletePushSubscriptionResultSchema,
          { method: 'DELETE' },
        );
        void queryClient.invalidateQueries({ queryKey: qk.notifications.pushDevices() });
        return res.data;
      } catch {
        return null;
      }
    },
    [queryClient],
  );

  return useMemo(() => ({ subscribe, remove }), [subscribe, remove]);
}
