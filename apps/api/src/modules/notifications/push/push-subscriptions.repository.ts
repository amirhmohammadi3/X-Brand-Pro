import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DrizzleClient } from '../../../db/drizzle.client.js';
import { pushSubscriptions } from '../../../db/schema/notifications.js';

/** DI token for the push-subscriptions repository (tests bind a fake). */
export const PUSH_SUBSCRIPTIONS_REPOSITORY = Symbol('PUSH_SUBSCRIPTIONS_REPOSITORY');

export interface PushSubscriptionMeta {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
}

/**
 * The narrow fake-able surface consumed by PushService. The endpoint
 * upsert REPLACES the row (new keys + user agent + owning user) — a
 * browser re-subscribing never accumulates duplicates.
 */
export interface PushSubscriptionsRepositoryLike {
  /** Insert-or-replace on the unique endpoint; returns the saved row. */
  upsertByEndpoint(input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<PushSubscriptionMeta>;
  listByUser(userId: string): Promise<PushSubscriptionMeta[]>;
  /** Owner-scoped delete (the id alone is not authorization). */
  deleteByIdAndUser(id: string, userId: string): Promise<boolean>;
  /** The 404/410 lifecycle: drop dead subscriptions after a failed send. */
  deleteByIds(ids: string[]): Promise<void>;
}

@Injectable()
export class PushSubscriptionsRepository implements PushSubscriptionsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async upsertByEndpoint(input: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<PushSubscriptionMeta> {
    const rows = await this.client.db
      .insert(pushSubscriptions)
      .values({
        userId: input.userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: input.userId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
        },
      })
      .returning({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
      });
    return rows[0] as PushSubscriptionMeta;
  }

  async listByUser(userId: string): Promise<PushSubscriptionMeta[]> {
    return this.client.db
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
  }

  async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId)))
      .returning({ id: pushSubscriptions.id });
    return deleted.length > 0;
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids));
  }
}
