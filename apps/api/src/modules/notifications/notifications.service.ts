import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  MarkNotificationsReadBody,
  NotificationDeliveryResult,
  NotificationEventKey,
  NotificationInboxResult,
  NotificationItem,
  NotificationPreference,
  NotificationPreferencesResult,
  NotificationEventsCatalogResult,
  PageQuery,
  UpdateNotificationPreferenceBody,
} from '@app/contracts';
import { NOTIFICATION_EVENT_DEFAULTS, NOTIFICATION_EVENT_KEYS } from '@app/contracts';
// Value imports: Nest reads constructor parameter types at runtime via
// emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailService } from '../email/email.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SmsService } from '../sms/sms.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from '../i18n/i18n.service.js';
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationChannelMatrix,
  type NotificationEventCatalogRow,
  type NotificationsRepositoryLike,
} from './notifications.repository.js';
import { PUSH_SENDER, type PushSenderLike } from './push/push.service.js';

/**
 * Domain events (AGENTS.md 6) — the notifications module's own signal.
 * B5.4's web-push sender and the F5.3 badge live-count subscribe to this;
 * nothing subscribes yet (B5.3 scope).
 */
export const NOTIFICATIONS_EVENTS = {
  /** An in-app notification landed in a user's inbox. */
  inAppDelivered: 'notification.in_app.delivered',
} as const;

/**
 * EventEmitter2 slice used by the service — kept as a structural type so
 * tests can pass a capture double instead of a full emitter.
 */
export interface NotificationEmitterLike {
  emit(event: string, payload: unknown): void;
}

/** The i18n key namespace notification texts live under. */
const I18N_NS = 'notifications';

/** The server default when users.locale is null (AGENTS.md: Persian-first). */
const DEFAULT_LOCALE = 'fa';

/**
 * Notification core (B5.3). `notify()` is the ONE entry point every future
 * producer (B5.7's subscribers, admin broadcasts) calls:
 *
 * 1. resolve the effective channel matrix — the user's preference row, else
 *    the catalog row, else the code defaults (each layer may be absent);
 *    an INACTIVE catalog row silences the event globally;
 * 2. deliver per channel, each inside its own try/catch — an email/SMS
 *    enqueue failure is reported as `delivered: false` and NEVER thrown;
 * 3. the in-app row stores the RAW vars; the title/body text is rendered
 *    per read from i18n (`notifications.<key>.title/.body`), so translations
 *    are admin-editable without touching history.
 *
 * The email channel renders title+body through the B1.6 `generic` template
 * (pre-translated server-side with the user's locale); the SMS channel
 * sends the translated body as plain text. `push` resolves in B5.4 — until
 * then the matrix accepts it but no channel consumes it.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repo: NotificationsRepositoryLike,
    private readonly i18n: I18nService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly sms?: SmsService,
    // B5.4 — bound via useExisting(PushService) in the module; optional so
    // unit tests (and a push-less boot) stay valid.
    @Optional() @Inject(PUSH_SENDER) private readonly pushSender?: PushSenderLike,
  ) {}

  private emitter?: NotificationEmitterLike;
  /** Injected by the module factory (kept optional for unit tests). */
  setEmitter(emitter: NotificationEmitterLike): void {
    this.emitter = emitter;
  }

  /** GET /notifications/events — the catalog merged over the code defaults. */
  async listCatalog(): Promise<NotificationEventsCatalogResult> {
    const rows = await this.safeEventRows();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return {
      events: NOTIFICATION_EVENT_KEYS.map((key) => {
        const row = byKey.get(key);
        return {
          key,
          channels: row
            ? { inApp: row.inApp, email: row.email, sms: row.sms, push: row.push }
            : NOTIFICATION_EVENT_DEFAULTS[key],
          isActive: row ? row.isActive : true,
        };
      }),
    };
  }

  /** GET /notifications/me/preferences — every known event with its effective matrix. */
  async listPreferences(userId: string): Promise<NotificationPreferencesResult> {
    const rows = await this.safePreferenceRows(userId);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const preferences: NotificationPreference[] = NOTIFICATION_EVENT_KEYS.map((key) => {
      const row = byKey.get(key);
      return row
        ? {
            eventKey: key,
            channels: { inApp: row.inApp, email: row.email, sms: row.sms, push: row.push },
            overridden: true,
          }
        : { eventKey: key, channels: NOTIFICATION_EVENT_DEFAULTS[key], overridden: false };
    });
    return { preferences };
  }

  /** PUT /notifications/me/preferences — partial merge, upsert, effective matrix back. */
  async updatePreference(
    userId: string,
    input: UpdateNotificationPreferenceBody,
  ): Promise<NotificationPreference> {
    const current = await this.safeFindPreference(userId, input.eventKey);
    const base: NotificationChannelMatrix = current
      ? { inApp: current.inApp, email: current.email, sms: current.sms, push: current.push }
      : NOTIFICATION_EVENT_DEFAULTS[input.eventKey];
    const matrix: NotificationChannelMatrix = {
      inApp: input.channels.inApp ?? base.inApp,
      email: input.channels.email ?? base.email,
      sms: input.channels.sms ?? base.sms,
      push: input.channels.push ?? base.push,
    };
    await this.repo.upsertPreferenceRow({ userId, key: input.eventKey, matrix });
    return { eventKey: input.eventKey, channels: matrix, overridden: true };
  }

  /**
   * THE delivery entry point (fail-soft, never throws). Unknown event keys
   * (a caller bug) are reported with every channel false instead of
   * breaking the producer's flow.
   */
  async notify(input: {
    userId: string;
    eventKey: NotificationEventKey;
    /** Interpolation vars for the i18n title/body AND the inbox payload. */
    vars: Record<string, string | number>;
  }): Promise<NotificationDeliveryResult> {
    const eventKey = input.eventKey;
    const known = (NOTIFICATION_EVENT_KEYS as readonly string[]).includes(eventKey);
    if (!known) {
      return {
        eventKey,
        channels: { inApp: false, email: false, sms: false, push: false },
        delivered: { inApp: false, email: false, sms: false, push: false },
      };
    }
    const channels = await this.resolveChannels(input.userId, eventKey);
    const delivered = { inApp: false, email: false, sms: false, push: false };

    if (channels.inApp) {
      try {
        await this.repo.insertNotification({
          userId: input.userId,
          key: eventKey,
          payload: input.vars,
        });
        delivered.inApp = true;
        this.emitter?.emit(NOTIFICATIONS_EVENTS.inAppDelivered, {
          userId: input.userId,
          eventKey,
        });
      } catch {
        delivered.inApp = false;
      }
    }

    if (channels.email || channels.sms || channels.push) {
      const contact = await this.safeContact(input.userId);
      const locale = contact?.locale || DEFAULT_LOCALE;
      if (channels.email && contact?.email) {
        try {
          const title = await this.translate(locale, `${eventKey}.title`, input.vars);
          const body = await this.translate(locale, `${eventKey}.body`, input.vars);
          if (this.email) {
            await this.email.send({
              to: contact.email,
              template: 'generic',
              locale,
              vars: { title, body },
            });
            delivered.email = true;
          }
        } catch {
          delivered.email = false;
        }
      }
      if (channels.sms && contact?.phone) {
        try {
          const body = await this.translate(locale, `${eventKey}.body`, input.vars);
          if (this.sms) {
            await this.sms.send(contact.phone, body);
            delivered.sms = true;
          }
        } catch {
          delivered.sms = false;
        }
      }
      // B5.4 — the push sender translates and self-cleans dead subscriptions;
      // an absent sender (push-less boot) simply reports undelivered.
      if (channels.push && this.pushSender) {
        try {
          delivered.push = await this.pushSender.sendToUser({
            userId: input.userId,
            eventKey,
            vars: input.vars,
            locale,
          });
        } catch {
          delivered.push = false;
        }
      }
    }

    return { eventKey, channels, delivered };
  }

  /** GET /notifications/me/inbox — newest first + the unread total. */
  async listInbox(userId: string, query: PageQuery): Promise<NotificationInboxResult> {
    const [{ rows, total }, unread] = await Promise.all([
      this.repo.listNotifications(userId, query.page, query.pageSize),
      this.repo.unreadCount(userId),
    ]);
    const items: NotificationItem[] = rows.map((row) => ({
      id: row.id,
      eventKey: row.key as NotificationEventKey,
      payload: row.payload,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      unread,
    };
  }

  /** POST /notifications/me/read — explicit ids or everything unread. */
  async markRead(userId: string, input: MarkNotificationsReadBody): Promise<{ marked: number }> {
    const marked = await this.repo.markRead(
      userId,
      input.all === true ? null : (input.ids ?? null),
    );
    return { marked };
  }

  // ─── channel resolution ───────────────────────────────────────────────────

  /**
   * preference row → catalog row (inactive = all off) → code defaults.
   * Every lookup is failure-tolerant: a dead repository answers the code
   * defaults rather than throwing out of notify().
   */
  private async resolveChannels(
    userId: string,
    eventKey: NotificationEventKey,
  ): Promise<NotificationChannelMatrix> {
    try {
      const pref = await this.repo.findPreferenceRow(userId, eventKey);
      if (pref) {
        return { inApp: pref.inApp, email: pref.email, sms: pref.sms, push: pref.push };
      }
      const event = await this.repo.findEventRow(eventKey);
      if (event) {
        if (!event.isActive) {
          return { inApp: false, email: false, sms: false, push: false };
        }
        return { inApp: event.inApp, email: event.email, sms: event.sms, push: event.push };
      }
    } catch {
      // fall through to the code defaults
    }
    return NOTIFICATION_EVENT_DEFAULTS[eventKey];
  }

  private async translate(
    locale: string,
    keySuffix: string,
    vars: Record<string, string | number>,
  ): Promise<string> {
    try {
      return await this.i18n.translate(locale, `${I18N_NS}.${keySuffix}`, vars);
    } catch {
      return `${I18N_NS}.${keySuffix}`; // the i18n fallback contract: the key itself
    }
  }

  private async safeContact(
    userId: string,
  ): Promise<{ email: string | null; phone: string | null; locale: string | null } | null> {
    try {
      return await this.repo.findUserContact(userId);
    } catch {
      return null;
    }
  }

  private async safeEventRows(): Promise<NotificationEventCatalogRow[]> {
    try {
      return await this.repo.listEventRows();
    } catch {
      return [];
    }
  }

  private async safePreferenceRows(userId: string) {
    try {
      return await this.repo.listPreferenceRows(userId);
    } catch {
      return [];
    }
  }

  private async safeFindPreference(userId: string, key: string) {
    try {
      return await this.repo.findPreferenceRow(userId, key);
    } catch {
      return null;
    }
  }
}
