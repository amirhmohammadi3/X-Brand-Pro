import { Inject, Injectable } from '@nestjs/common';
import type { PushSubscriptionItem, PushSubscriptionsResult } from '@app/contracts';
import webpush from 'web-push';
// Value import: Nest reads the constructor parameter type at runtime via
// emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { I18nService } from '../../i18n/i18n.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../../settings/settings.service.js';
import {
  PUSH_SUBSCRIPTIONS_REPOSITORY,
  type PushSubscriptionsRepositoryLike,
  type PushSubscriptionMeta,
} from './push-subscriptions.repository.js';

/** The settings keys the VAPID identity lives in (B5.4 registry entries). */
const VAPID_PUBLIC_KEY = 'push.vapid.publicKey';
const VAPID_PRIVATE_KEY = 'push.vapid.privateKey';
const VAPID_SUBJECT = 'push.vapid.subject';

const I18N_NS = 'notifications';
const DEFAULT_LOCALE = 'fa';

/** EventEmitter2-free structural sender contract the NotificationsService consumes. */
export interface PushSenderLike {
  sendToUser(input: {
    userId: string;
    eventKey: string;
    vars: Record<string, string | number>;
    locale: string;
  }): Promise<boolean>;
}

/** DI token binding PushService into NotificationsService (useExisting). */
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** The JSON payload a service worker's `push` handler receives. */
export interface PushPayload {
  title: string;
  body: string;
  eventKey: string;
}

/**
 * Web push (B5.4, VAPID). Responsibilities:
 * - OWN the subscription lifecycle: subscribe is an UPSERT on the unique
 *   endpoint (a re-subscribing browser replaces its row — new keys, fresh
 *   user agent, current owner), unsubscribe is owner-scoped, the list
 *   echoes NO key material (p256dh/auth are useless to the client and are
 *   browser-rotated anyway);
 * - DELIVER through `web-push` with the VAPID identity read from the
 *   settings registry at SEND time (`push.vapid.*` — empty keys = web
 *   push disabled, the channel reports undelivered);
 * - SELF-CLEAN: a push service answering 404/410 means the subscription
 *   is dead — the row is deleted at first failed send (the standard
 *   lifecycle; no sweep job needed);
 * - FAIL-SOFT like the rest of the notification core: sendToUser resolves
 *   false instead of throwing, so notify()'s guarantee holds.
 */
@Injectable()
export class PushService implements PushSenderLike {
  constructor(
    @Inject(PUSH_SUBSCRIPTIONS_REPOSITORY)
    private readonly repo: PushSubscriptionsRepositoryLike,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
  ) {}

  /** POST /notifications/me/push/subscriptions — upsert on endpoint. */
  async subscribe(
    userId: string,
    input: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string },
  ): Promise<PushSubscriptionItem> {
    const row = await this.repo.upsertByEndpoint({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
    });
    return this.toItem(row);
  }

  /** GET /notifications/me/push/subscriptions — the "my devices" list. */
  async listMine(userId: string): Promise<PushSubscriptionsResult> {
    const rows = await this.repo.listByUser(userId);
    return { items: rows.map((row) => this.toItem(row)) };
  }

  /** DELETE /notifications/me/push/subscriptions/:id — owner-scoped. */
  async unsubscribe(userId: string, id: string): Promise<{ deleted: boolean }> {
    const deleted = await this.repo.deleteByIdAndUser(id, userId);
    return { deleted };
  }

  /** The notify() push channel — fail-soft, self-cleaning. */
  async sendToUser(input: {
    userId: string;
    eventKey: string;
    vars: Record<string, string | number>;
    locale: string;
  }): Promise<boolean> {
    const vapid = await this.vapidConfig();
    if (!vapid) return false;
    const subs = await this.repo.listByUser(input.userId);
    if (subs.length === 0) return false;
    const payload = await this.renderPayload(input);
    let delivered = false;
    const stale: string[] = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { vapidDetails: vapid },
        );
        delivered = true;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          stale.push(sub.id); // the push service says this subscription no longer exists
        }
      }
    }
    if (stale.length > 0) {
      try {
        await this.repo.deleteByIds(stale);
      } catch {
        // cleanup is best-effort — the next send retries it
      }
    }
    return delivered;
  }

  /** The three settings keys, read at send time; null = push disabled. */
  private async vapidConfig(): Promise<{
    subject: string;
    publicKey: string;
    privateKey: string;
  } | null> {
    try {
      const [publicKey, privateKey, subject] = await Promise.all([
        this.settings.get<string>(VAPID_PUBLIC_KEY),
        this.settings.get<string>(VAPID_PRIVATE_KEY),
        this.settings.get<string>(VAPID_SUBJECT),
      ]);
      if (!publicKey || !privateKey || !subject) return null;
      return { subject, publicKey, privateKey };
    } catch {
      return null;
    }
  }

  private async renderPayload(input: {
    eventKey: string;
    vars: Record<string, string | number>;
    locale: string;
  }): Promise<PushPayload> {
    const locale = input.locale || DEFAULT_LOCALE;
    let title = `${I18N_NS}.${input.eventKey}.title`;
    let body = `${I18N_NS}.${input.eventKey}.body`;
    try {
      title = await this.i18n.translate(locale, `${I18N_NS}.${input.eventKey}.title`, input.vars);
    } catch {
      // keep the key fallback (the i18n contract)
    }
    try {
      body = await this.i18n.translate(locale, `${I18N_NS}.${input.eventKey}.body`, input.vars);
    } catch {
      // keep the key fallback
    }
    return { title, body, eventKey: input.eventKey };
  }

  private toItem(row: PushSubscriptionMeta): PushSubscriptionItem {
    return {
      id: row.id,
      endpoint: row.endpoint,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
