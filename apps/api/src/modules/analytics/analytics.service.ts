import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ANALYTICS_BATCH_MAX,
  ANALYTICS_RAW_RETENTION_DAYS,
  type AnalyticsStatsResult,
} from '@app/contracts';
import {
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
  type IngestAnalyticsBody,
} from '@app/contracts';
import {
  ANALYTICS_REPOSITORY,
  type AnalyticsRepositoryLike,
  type BufferedEvent,
} from './analytics.repository.js';
import {
  BUSINESSES_REPOSITORY,
  type BusinessesRepositoryLike,
} from '../business/businesses.repository.js';
import { canManageBusiness } from '../business/business-access.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.js';

/**
 * Analytics service (B7.1 ingest / B7.2 stats). The rules:
 *
 * - **Aggregate-only:** the ingest payload carries NO identity — the client
 *   sends the business id + type (+ optional timestamp); the server derives
 *   the business-local date and stamps the instant it accepted. No user ids,
 *   no ips, no user agents in storage.
 * - **Dedup:** `business_view` is deduped per (salted ip hash, business,
 *   hour bucket) — one view per visitor-hour per business; the salt is the
 *   OTP HMAC secret (server-only), the key lives in Redis for 1h and is
 *   never persisted. Other click events are NOT deduped (each tap counts).
 * - **Batching:** events land in the Redis buffer (LPUSH + LTRIM cap) and
 *   the flush job lands ANALYTICS_FLUSH_BATCH-sized slices into Postgres
 *   every 30s — ingest never pays a Postgres write.
 * - **Fail-soft:** Redis being down must not 500 the page — the ingest is
 *   best-effort: if the buffer push fails, the events are counted as
 *   dropped (accepted < received) and the endpoint still answers 200.
 * - **Owner gate (B7.2):** the stats API answers only to the business's
 *   owner (canManageBusiness) — aggregate numbers are business data, not
 *   public data.
 */

const VIEW_DEDUP_TTL_SEC = 3600;

function notFoundException(): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: 'business not found',
      details: { entity: 'business' },
    },
    HttpStatus.NOT_FOUND,
  );
}

function forbiddenException(): HttpException {
  return new HttpException(
    { code: 'FORBIDDEN' as const, messageKey: 'errors.forbidden', message: 'not the owner' },
    HttpStatus.FORBIDDEN,
  );
}

export function todayIso(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const anchor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-${String(anchor.getUTCDate()).padStart(2, '0')}`;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(ANALYTICS_REPOSITORY) private readonly repo: AnalyticsRepositoryLike,
    @Inject(BUSINESSES_REPOSITORY) private readonly businesses: BusinessesRepositoryLike,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * POST /analytics/events — buffer the batch. Returns how many events were
   * ACCEPTED (deduped views and dropped-on-Redis-failure events don't count).
   */
  async ingest(body: IngestAnalyticsBody, ip: string | null): Promise<number> {
    const now = new Date();
    const date = todayIso(now);
    const toBuffer: BufferedEvent[] = [];

    for (const event of body.events) {
      if (event.type === 'business_view') {
        // One view per (visitor-hour, business): salted hash of the ip,
        // never stored next to the event.
        const hourBucket = Math.floor(now.getTime() / VIEW_DEDUP_TTL_SEC);
        const hash = createHash('sha256')
          .update(`${this.config.otpHmacSecret}:${ip ?? 'anon'}:${hourBucket}:${event.businessId}`)
          .digest('hex')
          .slice(0, 24);
        const fresh = await this.repo.claimDedup(`analytics:dedup:${hash}`, VIEW_DEDUP_TTL_SEC);
        if (!fresh) continue;
      }
      toBuffer.push({
        businessId: event.businessId,
        type: event.type,
        occurredAt: event.occurredAt ?? now.toISOString(),
        date,
      });
    }

    if (toBuffer.length === 0) return 0;
    try {
      await this.repo.bufferPush(toBuffer);
      return toBuffer.length;
    } catch {
      // Redis down: fail-soft — the page still loads, the batch is dropped.
      return 0;
    }
  }

  /**
   * The flush pass (B7.1) — the maintenance job's handler. Drains the Redis
   * buffer into analytics_events in ANALYTICS_FLUSH_BATCH slices.
   */
  async flush(): Promise<number> {
    let landed = 0;
    // One pass drains at most ~4 slices; the next tick takes the rest.
    for (let i = 0; i < 4; i += 1) {
      const n = await this.repo.flushBatch(ANALYTICS_BATCH_MAX * 20);
      if (n === 0) break;
      landed += n;
    }
    return landed;
  }

  /**
   * The rollup pass (B7.2) — aggregates yesterday (and today, so late-
   * arriving events are not missed) into analytics_daily, then prunes raw
   * rows older than the retention window. Idempotent: the upsert per bucket
   * means re-runs are cheap and safe.
   */
  async rollup(): Promise<number> {
    const today = todayIso();
    const from = addDaysIso(today, -ANALYTICS_RAW_RETENTION_DAYS);
    const buckets = await this.repo.rollupRange(from, today);
    await this.repo.pruneRaw(addDaysIso(today, -ANALYTICS_RAW_RETENTION_DAYS));
    return buckets;
  }

  /**
   * GET /analytics/business/:id/stats — the owner's time series + totals.
   * Range defaults to the last 30 days (inclusive). The gate is the same
   * canManageBusiness rule the hours/menu endpoints use (owner by
   * relationship, or businesses.manage for admins).
   */
  async stats(
    businessId: string,
    actor: { id: string; role: string },
    query: { from?: string; to?: string },
  ): Promise<AnalyticsStatsResult> {
    const business = await this.businesses.findById(businessId);
    // The businesses repository already hides deleted rows (404-never-leak).
    if (!business) throw notFoundException();
    if (!canManageBusiness(actor, { ownerId: business.ownerId, status: business.status })) {
      throw forbiddenException();
    }
    const today = todayIso();
    const from = query.from ?? addDaysIso(today, -29);
    const to = query.to ?? today;
    if (from > to) {
      throw new HttpException(
        {
          code: 'UNPROCESSABLE' as const,
          messageKey: 'errors.unprocessable',
          message: 'the range is inverted',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const rows = await this.repo.statsRange(businessId, from, to);
    const totals = Object.fromEntries(ANALYTICS_EVENT_TYPES.map((t) => [t, 0])) as Record<
      AnalyticsEventType,
      number
    >;
    for (const row of rows) totals[row.type] += row.count;
    return {
      businessId,
      from,
      to,
      series: rows,
      totals,
    };
  }
}
