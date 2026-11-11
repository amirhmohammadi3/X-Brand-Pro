import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { users } from '../../db/schema/users.js';
import {
  notificationEvents,
  notificationPreferences,
  notifications,
} from '../../db/schema/notifications.js';

/** DI token for the notifications repository (tests bind a fake). */
export const NOTIFICATIONS_REPOSITORY = Symbol('NOTIFICATIONS_REPOSITORY');

/** The per-event channel matrix shape (mirrors the contracts schema). */
export interface NotificationChannelMatrix {
  inApp: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

/** The catalog row as the service consumes it (channels flattened). */
export interface NotificationEventCatalogRow extends NotificationChannelMatrix {
  key: string;
  isActive: boolean;
}

export interface NotificationPreferenceRowMeta extends NotificationChannelMatrix {
  userId: string;
  key: string;
}

export interface NotificationRowMeta {
  id: string;
  userId: string;
  key: string;
  payload: Record<string, string | number>;
  readAt: Date | null;
  createdAt: Date;
}

/** The caller's contact surface for the email/SMS channels. */
export interface UserContact {
  email: string | null;
  phone: string | null;
  /** users.locale — null = server default (fa). */
  locale: string | null;
}

/**
 * The narrow fake-able surface consumed by NotificationsService + the HTTP
 * layer. Preference upserts overwrite the FULL matrix (the service merges
 * the partial input first).
 */
export interface NotificationsRepositoryLike {
  findEventRow(key: string): Promise<NotificationEventCatalogRow | null>;
  listEventRows(): Promise<NotificationEventCatalogRow[]>;
  findPreferenceRow(userId: string, key: string): Promise<NotificationPreferenceRowMeta | null>;
  listPreferenceRows(userId: string): Promise<NotificationPreferenceRowMeta[]>;
  /** Full-matrix upsert on (user_id, key). */
  upsertPreferenceRow(input: {
    userId: string;
    key: string;
    matrix: NotificationChannelMatrix;
  }): Promise<void>;
  insertNotification(input: {
    userId: string;
    key: string;
    payload: Record<string, string | number>;
  }): Promise<void>;
  listNotifications(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: NotificationRowMeta[]; total: number }>;
  unreadCount(userId: string): Promise<number>;
  /** `ids === null` marks everything unread (mark-all). Returns rows updated. */
  markRead(userId: string, ids: string[] | null): Promise<number>;
  findUserContact(userId: string): Promise<UserContact | null>;
}

@Injectable()
export class NotificationsRepository implements NotificationsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findEventRow(key: string): Promise<NotificationEventCatalogRow | null> {
    const rows = await this.client.db
      .select({
        key: notificationEvents.key,
        inApp: notificationEvents.inApp,
        email: notificationEvents.email,
        sms: notificationEvents.sms,
        push: notificationEvents.push,
        isActive: notificationEvents.isActive,
      })
      .from(notificationEvents)
      .where(eq(notificationEvents.key, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async listEventRows(): Promise<NotificationEventCatalogRow[]> {
    return this.client.db
      .select({
        key: notificationEvents.key,
        inApp: notificationEvents.inApp,
        email: notificationEvents.email,
        sms: notificationEvents.sms,
        push: notificationEvents.push,
        isActive: notificationEvents.isActive,
      })
      .from(notificationEvents);
  }

  async findPreferenceRow(
    userId: string,
    key: string,
  ): Promise<NotificationPreferenceRowMeta | null> {
    const rows = await this.client.db
      .select({
        userId: notificationPreferences.userId,
        key: notificationPreferences.key,
        inApp: notificationPreferences.inApp,
        email: notificationPreferences.email,
        sms: notificationPreferences.sms,
        push: notificationPreferences.push,
      })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.key, key)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPreferenceRows(userId: string): Promise<NotificationPreferenceRowMeta[]> {
    return this.client.db
      .select({
        userId: notificationPreferences.userId,
        key: notificationPreferences.key,
        inApp: notificationPreferences.inApp,
        email: notificationPreferences.email,
        sms: notificationPreferences.sms,
        push: notificationPreferences.push,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
  }

  async upsertPreferenceRow(input: {
    userId: string;
    key: string;
    matrix: NotificationChannelMatrix;
  }): Promise<void> {
    await this.client.db
      .insert(notificationPreferences)
      .values({
        userId: input.userId,
        key: input.key,
        inApp: input.matrix.inApp,
        email: input.matrix.email,
        sms: input.matrix.sms,
        push: input.matrix.push,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.key],
        set: {
          inApp: input.matrix.inApp,
          email: input.matrix.email,
          sms: input.matrix.sms,
          push: input.matrix.push,
          updatedAt: new Date(),
        },
      });
  }

  async insertNotification(input: {
    userId: string;
    key: string;
    payload: Record<string, string | number>;
  }): Promise<void> {
    await this.client.db.insert(notifications).values({
      userId: input.userId,
      key: input.key,
      payload: input.payload,
    });
  }

  async listNotifications(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: NotificationRowMeta[]; total: number }> {
    const where: SQL = eq(notifications.userId, userId);
    const [rows, totals] = await Promise.all([
      this.client.db
        .select({
          id: notifications.id,
          userId: notifications.userId,
          key: notifications.key,
          payload: notifications.payload,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.client.db.select({ value: count() }).from(notifications).where(where),
    ]);
    return {
      rows: rows.map((r) => ({
        ...r,
        payload: (r.payload ?? {}) as Record<string, string | number>,
      })),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.client.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return Number(rows[0]?.value ?? 0);
  }

  async markRead(userId: string, ids: string[] | null): Promise<number> {
    const where =
      ids === null
        ? (and(eq(notifications.userId, userId), isNull(notifications.readAt)) as SQL)
        : (and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            inArray(notifications.id, ids),
          ) as SQL);
    const updated = await this.client.db
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(where)
      .returning({ id: notifications.id });
    return updated.length;
  }

  async findUserContact(userId: string): Promise<UserContact | null> {
    const rows = await this.client.db
      .select({ email: users.email, phone: users.phone, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }
}
