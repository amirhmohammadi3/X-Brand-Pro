import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * Analytics contracts (B7.1/B7.2). The ingest payload (public, batched) and
 * the stats API shapes (owner-only). The privacy promise governs everything:
 * the client sends NO identity — no user id, no ip, no fingerprints — only
 * the business id + the event type (+ optional client timestamp). Dedup is
 * the API's job on a salted ip hash held in Redis for an hour, never stored.
 */

/** The measurable event vocabulary (mirrors the analytics_event_type enum). */
export const ANALYTICS_EVENT_TYPES = [
  'business_view',
  'call_click',
  'direction_click',
  'share_click',
  'impression',
] as const;
export const analyticsEventTypeSchema = z.enum(ANALYTICS_EVENT_TYPES);
export type AnalyticsEventType = z.infer<typeof analyticsEventTypeSchema>;

/** Max events per ingest call (the client batches up to this many). */
export const ANALYTICS_BATCH_MAX = 25;

/** Ingest rate limit (public endpoint, ip-scoped). */
export const ANALYTICS_INGEST_LIMIT_PER_MIN = 60;

/** Events buffered in Redis before the flush job lands them in Postgres. */
export const ANALYTICS_FLUSH_EVERY_MS = 30_000;
export const ANALYTICS_FLUSH_BATCH = 500;
/** Redis buffer cap (LTRIM) — a dead flusher drops the oldest beyond this. */
export const ANALYTICS_BUFFER_CAP = 10_000;

/** Raw rows older than this are pruned once their rollup is written (B7.2). */
export const ANALYTICS_RAW_RETENTION_DAYS = 90;

/** Stats API rate limit (owner reads). */
export const ANALYTICS_STATS_LIMIT_PER_MIN = 60;

/** One ingested event (POST /analytics/events body item). */
export const analyticsEventInputSchema = z
  .object({
    businessId: uuidSchema,
    type: analyticsEventTypeSchema,
    /** Client wall-clock instant (optional; the server stamps when absent). */
    occurredAt: z.string().datetime().optional(),
  })
  .strict();
export type AnalyticsEventInput = z.infer<typeof analyticsEventInputSchema>;

export const ingestAnalyticsBodySchema = z
  .object({
    events: z.array(analyticsEventInputSchema).min(1).max(ANALYTICS_BATCH_MAX),
  })
  .strict();
export type IngestAnalyticsBody = z.infer<typeof ingestAnalyticsBodySchema>;

export const ingestAnalyticsResultSchema = z.object({ accepted: z.number().int().min(0) }).strict();
export type IngestAnalyticsResult = z.infer<typeof ingestAnalyticsResultSchema>;

/** GET /analytics/business/:id/stats — the owner dashboard query (B7.2). */
export const analyticsStatsQuerySchema = z
  .object({
    /** `YYYY-MM-DD` (business-local); defaults to the last 30 days. */
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid date')
      .optional(),
  })
  .strict();
export type AnalyticsStatsQuery = z.infer<typeof analyticsStatsQuerySchema>;

/** One time-series point (a business-day × event-type count). */
export const analyticsPointSchema = z
  .object({
    date: z.string(),
    type: analyticsEventTypeSchema,
    count: z.number().int().min(0),
  })
  .strict();
export type AnalyticsPoint = z.infer<typeof analyticsPointSchema>;

/** The stats result: the series + anonymous totals (B7.2). */
export const analyticsStatsResultSchema = z
  .object({
    businessId: uuidSchema,
    from: z.string(),
    to: z.string(),
    series: z.array(analyticsPointSchema),
    totals: z.record(analyticsEventTypeSchema, z.number().int().min(0)),
  })
  .strict();
export type AnalyticsStatsResult = z.infer<typeof analyticsStatsResultSchema>;
