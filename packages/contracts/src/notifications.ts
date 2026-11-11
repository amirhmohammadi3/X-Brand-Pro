import { z } from 'zod';
import { pageMetaSchema } from './pagination.js';
import { uuidSchema } from './primitives.js';

/**
 * Notification core (B5.3): the event catalog, the per-user channel
 * preferences, the in-app inbox and the delivery channels (email + SMS
 * through the B1.5/B1.6 queue-backed services; web push joins in B5.4).
 *
 * Three storage layers:
 * - `notification_events` — the CATALOG (seeded from
 *   NOTIFICATION_EVENT_KEYS, admin-editable later): per event the DEFAULT
 *   channel matrix. A missing row falls back to the code defaults
 *   (NOTIFICATION_EVENT_DEFAULTS) — the catalog is an optimization, never
 *   a hard dependency.
 * - `notification_preferences` — the USER's overrides, one row per
 *   (user_id, event_key) on demand; an absent row means "use the event
 *   defaults" (no bulk-write at registration).
 * - `notifications` — the in-app INBOX: one row per delivered in-app
 *   notification, payload = the interpolation vars (re-rendered per read,
 *   so a translation fix repairs old rows for free).
 *
 * The rendered TEXT lives in the i18n tables under
 * `notifications.<event_key>.title` / `.body` (B5.3's "translatable
 * template" requirement) — interpolated server-side via I18nService with
 * the user's preferred locale (falling back to the site default, then the
 * key itself), exactly like the rest of the i18n domain. Adding an event
 * needs: one contracts key, one defaults entry, one i18n key pair — no
 * migration.
 *
 * Delivery is FAIL-SOFT by design: `notify()` never throws — an unknown
 * event key or a dead channel drops the notification and reports the
 * outcome. B5.7's subscribers run in the review/question/follow request
 * paths (directly or via the feed subscriber); a notification failure must
 * never break a review.
 */

/**
 * The catalog (v1) — every key is wireable from an event that ALREADY
 * exists (B4.1/B4.8/B5.2), so B5.7's wiring needs zero schema changes:
 * - review.replied      ← review.replied      (to the review author)
 * - review.voted        ← review.voted        (to the review author)
 * - question.answered   ← question.answered   (to the asker)
 * - follow.created      ← follow.created      (to the followed user)
 * - business.favorited  ← favorite.added      (to the business owner)
 */
export const NOTIFICATION_EVENT_KEYS = [
  'review.replied',
  'review.voted',
  'question.answered',
  'follow.created',
  'business.favorited',
] as const;
export const notificationEventKeySchema = z.enum(NOTIFICATION_EVENT_KEYS);
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

/** The code-side default channel matrix, keyed by event (catalog fallback). */
export const NOTIFICATION_EVENT_DEFAULTS: Record<
  NotificationEventKey,
  { inApp: boolean; email: boolean; sms: boolean; push: boolean }
> = {
  'review.replied': { inApp: true, email: true, sms: false, push: false },
  'review.voted': { inApp: true, email: false, sms: false, push: false },
  'question.answered': { inApp: true, email: true, sms: false, push: false },
  'follow.created': { inApp: true, email: false, sms: false, push: false },
  'business.favorited': { inApp: true, email: false, sms: false, push: false },
};

/** The delivery channels (web push becomes deliverable in B5.4). */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** The per-event channel matrix as stored/edited. */
export const notificationChannelsSchema = z
  .object({
    inApp: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  })
  .strict();
export type NotificationChannels = z.infer<typeof notificationChannelsSchema>;

/** One catalog row as served by GET /notifications/events. */
export const notificationEventCatalogItemSchema = z
  .object({
    key: notificationEventKeySchema,
    /** The event's DEFAULT channels (what a user with no override gets). */
    channels: notificationChannelsSchema,
    /** An inactive event delivers nothing (all channels skipped). */
    isActive: z.boolean(),
  })
  .strict();
export type NotificationEventCatalogItem = z.infer<typeof notificationEventCatalogItemSchema>;

export const notificationEventsCatalogResultSchema = z
  .object({ events: z.array(notificationEventCatalogItemSchema) })
  .strict();
export type NotificationEventsCatalogResult = z.infer<typeof notificationEventsCatalogResultSchema>;

/** One merged preference (override applied over defaults). */
export const notificationPreferenceSchema = z
  .object({
    eventKey: notificationEventKeySchema,
    channels: notificationChannelsSchema,
    /** True when the user has an explicit row (vs. the effective defaults). */
    overridden: z.boolean(),
  })
  .strict();
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const notificationPreferencesResultSchema = z
  .object({ preferences: z.array(notificationPreferenceSchema) })
  .strict();
export type NotificationPreferencesResult = z.infer<typeof notificationPreferencesResultSchema>;

/** PUT /notifications/me/preferences body — partial channel merge per event. */
export const updateNotificationPreferenceBodySchema = z
  .object({
    eventKey: notificationEventKeySchema,
    channels: z
      .object({
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        push: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export type UpdateNotificationPreferenceBody = z.infer<
  typeof updateNotificationPreferenceBodySchema
>;

/** One inbox row. `payload` is the RAW var map (the UI re-renders via i18n keys). */
export const notificationItemSchema = z
  .object({
    id: uuidSchema,
    eventKey: notificationEventKeySchema,
    /** Interpolation vars for notifications.<eventKey>.title/.body. */
    payload: z.record(z.union([z.string(), z.number()])),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type NotificationItem = z.infer<typeof notificationItemSchema>;

/** GET /notifications/me/inbox — newest first, with the unread total. */
export const notificationInboxResultSchema = z
  .object({
    items: z.array(notificationItemSchema),
    meta: pageMetaSchema,
    unread: z.number().int().min(0),
  })
  .strict();
export type NotificationInboxResult = z.infer<typeof notificationInboxResultSchema>;

/** POST /notifications/me/read body — explicit ids OR everything unread. */
export const markNotificationsReadBodySchema = z
  .object({
    ids: z.array(uuidSchema).min(1).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.all === true || (v.ids !== undefined && v.ids.length > 0), {
    message: 'either ids or all is required',
  });
export type MarkNotificationsReadBody = z.infer<typeof markNotificationsReadBodySchema>;

export const markNotificationsReadResultSchema = z
  .object({ marked: z.number().int().min(0) })
  .strict();
export type MarkNotificationsReadResult = z.infer<typeof markNotificationsReadResultSchema>;

// ─── Web push subscriptions (B5.4) ─────────────────────────────────────────

/** The browser-generated encryption keys the W3C Push API mandates. */
export const pushSubscriptionKeysSchema = z
  .object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(200),
  })
  .strict();
export type PushSubscriptionKeys = z.infer<typeof pushSubscriptionKeysSchema>;

/** POST /notifications/me/push/subscriptions body (the PushSubscription the browser hands over). */
export const createPushSubscriptionBodySchema = z
  .object({
    /** The push service URL (FCM/Mozilla) — must be https. */
    endpoint: z
      .string()
      .url()
      .max(500)
      .refine((v) => v.startsWith('https://'), {
        message: 'endpoint must be https',
      }),
    keys: pushSubscriptionKeysSchema,
    userAgent: z.string().max(300).optional(),
  })
  .strict();
export type CreatePushSubscriptionBody = z.infer<typeof createPushSubscriptionBodySchema>;

/** One saved subscription as the "my devices" list serves it (keys NEVER echoed). */
export const pushSubscriptionItemSchema = z
  .object({
    id: uuidSchema,
    endpoint: z.string().max(500),
    userAgent: z.string().max(300).nullable(),
    createdAt: z.string(),
  })
  .strict();
export type PushSubscriptionItem = z.infer<typeof pushSubscriptionItemSchema>;

export const pushSubscriptionsResultSchema = z
  .object({ items: z.array(pushSubscriptionItemSchema) })
  .strict();
export type PushSubscriptionsResult = z.infer<typeof pushSubscriptionsResultSchema>;

export const deletePushSubscriptionResultSchema = z.object({ deleted: z.boolean() }).strict();
export type DeletePushSubscriptionResult = z.infer<typeof deletePushSubscriptionResultSchema>;

/** Push subscription writes are the same one-row budget as the rest of the module. */
export const PUSH_WRITE_LIMIT_PER_MIN = 30;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - preference writes + mark-read → 30/min per user (the B5.1 write budget);
 * - inbox/preferences/catalog reads → 60/min per user.
 */
export const NOTIFICATION_WRITE_LIMIT_PER_MIN = 30;
export const NOTIFICATION_READ_LIMIT_PER_MIN = 60;

/** The internal delivery outcome notify() reports (never throws). */
export const notificationDeliveryResultSchema = z
  .object({
    eventKey: notificationEventKeySchema,
    /** What the resolved channel matrix said to do. */
    channels: notificationChannelsSchema,
    /** What actually happened per channel (false = disabled, missing contact or failed). */
    delivered: z.object({
      inApp: z.boolean(),
      email: z.boolean(),
      sms: z.boolean(),
      /** B5.4 — a push send RESOLVED to at least one subscription. */
      push: z.boolean(),
    }),
  })
  .strict();
export type NotificationDeliveryResult = z.infer<typeof notificationDeliveryResultSchema>;
