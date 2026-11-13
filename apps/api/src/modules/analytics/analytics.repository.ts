import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  analyticsDaily,
  analyticsEvents,
  type NewAnalyticsEventRow,
} from '../../db/schema/analytics.js';
import { REDIS, type RedisLike } from '../../redis/redis.client.js';
import {
  ANALYTICS_BUFFER_CAP,
  ANALYTICS_FLUSH_BATCH,
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
} from '@app/contracts';

/** DI token for the analytics repository (tests bind a fake). */
export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');

export const ANALYTICS_BUFFER_KEY = 'analytics:buffer';

/** One buffered event (JSON in the Redis list). */
export interface BufferedEvent {
  businessId: string;
  type: AnalyticsEventType;
  occurredAt: string;
  /** Business-local date — computed at ingest, not flush. */
  date: string;
}

/**
 * The narrow fake-able surface: the Postgres writes, the Redis buffer ops
 * and the rollup/stats queries. The Redis interactions live HERE (not a
 * separate service) because the flush is repository-shaped: read slice →
 * insert → trim, one unit.
 */
export interface AnalyticsRepositoryLike {
  /** LPUSH + LTRIM cap (oldest dropped beyond the cap). */
  bufferPush(events: BufferedEvent[]): Promise<void>;
  /** The buffer's current length (best effort, for tests). */
  bufferLength(): Promise<number>;
  /**
   * Read up to `batch` events, insert them, and trim the consumed slice on
   * success (read → insert → trim — a failed insert keeps the buffer intact).
   */
  flushBatch(batch: number): Promise<number>;
  /** Dedup claim (SETNX + EX semantics) — true when this bucket is fresh. */
  claimDedup(key: string, ttlSec: number): Promise<boolean>;
  /**
   * Roll up raw events into `analytics_daily` for [from, to] (idempotent
   * upsert per bucket) — returns the number of buckets written (B7.2).
   */
  rollupRange(from: string, to: string): Promise<number>;
  /** Delete raw rows on/before `olderThan` after their rollup (B7.2). */
  pruneRaw(olderThan: string): Promise<number>;
  /** The stats read: one row per (date, type) bucket (owner API, B7.2). */
  statsRange(
    businessId: string,
    from: string,
    to: string,
  ): Promise<Array<{ date: string; type: AnalyticsEventType; count: number }>>;
}

@Injectable()
export class AnalyticsRepository implements AnalyticsRepositoryLike {
  constructor(
    @Inject(DrizzleClient) private readonly client: DrizzleClient,
    @Inject(REDIS) private readonly redis: RedisLike,
  ) {}

  async bufferPush(events: BufferedEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const event of events) {
      await this.redis.lpush(ANALYTICS_BUFFER_KEY, JSON.stringify(event));
    }
    // Keep the newest ANALYTICS_BUFFER_CAP entries (LPUSH head → trim tail).
    await this.redis.ltrim(ANALYTICS_BUFFER_KEY, 0, ANALYTICS_BUFFER_CAP - 1);
  }

  async bufferLength(): Promise<number> {
    const all = await this.redis.lrange(ANALYTICS_BUFFER_KEY, 0, -1);
    return all.length;
  }

  async flushBatch(batch: number): Promise<number> {
    const take = Math.min(batch, ANALYTICS_FLUSH_BATCH);
    const raw = await this.redis.lrange(ANALYTICS_BUFFER_KEY, 0, take - 1);
    if (raw.length === 0) return 0;
    const parsed: BufferedEvent[] = [];
    for (const item of raw) {
      try {
        const event = JSON.parse(item) as BufferedEvent;
        if (
          event &&
          typeof event.businessId === 'string' &&
          ANALYTICS_EVENT_TYPES.includes(event.type)
        ) {
          parsed.push(event);
        }
      } catch {
        // A corrupt entry is dropped with the slice (never blocks the flush).
      }
    }
    if (parsed.length > 0) {
      const rows: NewAnalyticsEventRow[] = parsed.map((event) => ({
        businessId: event.businessId,
        eventType: event.type,
        date: event.date,
        occurredAt: new Date(event.occurredAt),
      }));
      await this.client.db.insert(analyticsEvents).values(rows);
    }
    // Consume the slice only after a successful insert.
    await this.redis.ltrim(ANALYTICS_BUFFER_KEY, raw.length, -1);
    return parsed.length;
  }

  async claimDedup(key: string, ttlSec: number): Promise<boolean> {
    const existing = await this.redis.get(key);
    if (existing) return false;
    await this.redis.set(key, '1', 'EX', ttlSec);
    return true;
  }

  async rollupRange(from: string, to: string): Promise<number> {
    // Group the raw rows per bucket, then upsert (idempotent — re-runs safe).
    const grouped = await this.client.db
      .select({
        businessId: analyticsEvents.businessId,
        date: analyticsEvents.date,
        eventType: analyticsEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.date, from), lte(analyticsEvents.date, to)))
      .groupBy(analyticsEvents.businessId, analyticsEvents.date, analyticsEvents.eventType);
    if (grouped.length === 0) return 0;
    const inserted = await this.client.db
      .insert(analyticsDaily)
      .values(
        grouped.map((row) => ({
          businessId: row.businessId,
          date: row.date,
          eventType: row.eventType,
          count: Number(row.count),
        })),
      )
      .onConflictDoUpdate({
        target: [analyticsDaily.businessId, analyticsDaily.date, analyticsDaily.eventType],
        set: {
          count: sql`excluded.count`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: analyticsDaily.id });
    return inserted.length;
  }

  async pruneRaw(olderThan: string): Promise<number> {
    const deleted = await this.client.db
      .delete(analyticsEvents)
      .where(lte(analyticsEvents.date, olderThan))
      .returning({ id: analyticsEvents.id });
    return deleted.length;
  }

  async statsRange(
    businessId: string,
    from: string,
    to: string,
  ): Promise<Array<{ date: string; type: AnalyticsEventType; count: number }>> {
    const rows = await this.client.db
      .select({
        date: analyticsDaily.date,
        type: analyticsDaily.eventType,
        count: analyticsDaily.count,
      })
      .from(analyticsDaily)
      .where(
        and(
          eq(analyticsDaily.businessId, businessId),
          gte(analyticsDaily.date, from),
          lte(analyticsDaily.date, to),
        ),
      )
      .orderBy(asc(analyticsDaily.date));
    return rows.map((row) => ({
      date: row.date,
      type: row.type,
      count: Number(row.count),
    }));
  }
}
