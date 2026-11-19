import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  aiReviewSummaries,
  type AiReviewSummaryRow,
  type NewAiReviewSummaryRow,
} from '../../db/schema/ai-review-summaries.js';

/** DI token for the AI review summaries repository (tests bind a fake). */
export const AI_REVIEW_SUMMARIES_REPOSITORY = Symbol('AI_REVIEW_SUMMARIES_REPOSITORY');

/** The narrow fake-able surface. Kept small so tests stay trivial. */
export interface AiReviewSummariesRepositoryLike {
  /** Find a business's summary (null if none yet). */
  findByBusinessId(businessId: string): Promise<AiReviewSummaryRow | null>;
  /** Upsert the summary row (insert if absent, update if present). */
  upsert(row: NewAiReviewSummaryRow): Promise<AiReviewSummaryRow>;
  /** Mark a business's summary as stale (a review changed). No-op if no row yet. */
  markStale(businessId: string, now: Date): Promise<void>;
  /** Find stale summaries older than `cutoff` (the debounce sweep). */
  findStaleOlderThan(cutoff: Date, limit: number): Promise<AiReviewSummaryRow[]>;
}

/**
 * Drizzle-backed AI review summaries repository (A9.3).
 *
 * The unique index on `business_id` makes upsert a single statement
 * (INSERT ... ON CONFLICT (business_id) DO UPDATE). The `markStale` call
 * is the debounce trigger: a review changes → the subscriber sets `stale =
 * true` → the queue job (debounced 60s) picks up stale rows older than
 * the cutoff + regenerates them.
 */
@Injectable()
export class AiReviewSummariesRepository implements AiReviewSummariesRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly drizzle: DrizzleClient) {}

  async findByBusinessId(businessId: string): Promise<AiReviewSummaryRow | null> {
    const db = this.drizzle.db;
    const rows = await db
      .select()
      .from(aiReviewSummaries)
      .where(eq(aiReviewSummaries.businessId, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(row: NewAiReviewSummaryRow): Promise<AiReviewSummaryRow> {
    const db = this.drizzle.db;
    const inserted = await db
      .insert(aiReviewSummaries)
      .values(row)
      .onConflictDoUpdate({
        target: aiReviewSummaries.businessId,
        set: {
          summary: row.summary,
          driver: row.driver,
          model: row.model,
          promptVersion: row.promptVersion,
          stale: false,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          reviewCount: row.reviewCount,
          reviewAvgRating: row.reviewAvgRating,
          lastError: row.lastError,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (inserted.length === 0) {
      throw new Error('ai_review_summaries upsert returned no row');
    }
    return inserted[0]!;
  }

  async markStale(businessId: string, _now: Date): Promise<void> {
    const db = this.drizzle.db;
    await db
      .update(aiReviewSummaries)
      .set({ stale: true })
      .where(and(eq(aiReviewSummaries.businessId, businessId), eq(aiReviewSummaries.stale, false)));
  }

  async findStaleOlderThan(cutoff: Date, limit: number): Promise<AiReviewSummaryRow[]> {
    const db = this.drizzle.db;
    return db
      .select()
      .from(aiReviewSummaries)
      .where(
        and(eq(aiReviewSummaries.stale, true), sql`${aiReviewSummaries.updatedAt} < ${cutoff}`),
      )
      .orderBy(desc(aiReviewSummaries.updatedAt))
      .limit(limit);
  }
}
