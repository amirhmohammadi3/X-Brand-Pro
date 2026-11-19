import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import {
  aiFraudScores,
  type AiFraudScoreRow,
  type NewAiFraudScoreRow,
} from '../../db/schema/ai-fraud-scores.js';

/** DI token for the AI fraud scores repository (tests bind a fake). */
export const AI_FRAUD_SCORES_REPOSITORY = Symbol('AI_FRAUD_SCORES_REPOSITORY');

/** The narrow fake-able surface. */
export interface AiFraudScoresRepositoryLike {
  /** Find a review's score (null if none yet). */
  findByReviewId(reviewId: string): Promise<AiFraudScoreRow | null>;
  /** Upsert the score row (insert if absent, update if present). */
  upsert(row: NewAiFraudScoreRow): Promise<AiFraudScoreRow>;
  /** Mark a review's score as stale. */
  markStale(reviewId: string, now: Date): Promise<void>;
  /** The moderation queue: scores >= minScore, joined with review/business/user. */
  listQueue(
    minScore: number,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      reviewId: string;
      businessId: string;
      businessName: string;
      userId: string;
      userUsername: string;
      rating: number;
      body: string;
      reviewStatus: string;
      score: number;
      signals: string | null;
      scoreUpdatedAt: Date;
      reviewCreatedAt: Date;
    }>;
    total: number;
  }>;
}

/**
 * Drizzle-backed AI fraud scores repository (A9.6). One row per review
 * (unique on review_id); upsert is an INSERT ... ON CONFLICT DO UPDATE.
 *
 * The moderation-queue join (review + business + user) is done via a raw
 * SQL query — the alternative (loading each row + a separate lookup) is
 * O(n) extra queries per page.
 */
@Injectable()
export class AiFraudScoresRepository implements AiFraudScoresRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly drizzle: DrizzleClient) {}

  async findByReviewId(reviewId: string): Promise<AiFraudScoreRow | null> {
    const db = this.drizzle.db;
    const rows = await db
      .select()
      .from(aiFraudScores)
      .where(eq(aiFraudScores.reviewId, reviewId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(row: NewAiFraudScoreRow): Promise<AiFraudScoreRow> {
    const db = this.drizzle.db;
    const inserted = await db
      .insert(aiFraudScores)
      .values(row)
      .onConflictDoUpdate({
        target: aiFraudScores.reviewId,
        set: {
          score: row.score,
          driver: row.driver,
          model: row.model,
          promptVersion: row.promptVersion,
          stale: false,
          signals: row.signals,
          promptTokens: row.promptTokens ?? 0,
          completionTokens: row.completionTokens ?? 0,
          lastError: row.lastError ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (inserted.length === 0) {
      throw new Error('ai_fraud_scores upsert returned no row');
    }
    return inserted[0]!;
  }

  async markStale(reviewId: string, _now: Date): Promise<void> {
    const db = this.drizzle.db;
    await db
      .update(aiFraudScores)
      .set({ stale: true })
      .where(and(eq(aiFraudScores.reviewId, reviewId), eq(aiFraudScores.stale, false)));
  }

  async listQueue(
    minScore: number,
    limit: number,
    offset: number,
  ): Promise<{
    rows: Array<{
      reviewId: string;
      businessId: string;
      businessName: string;
      userId: string;
      userUsername: string;
      rating: number;
      body: string;
      reviewStatus: string;
      score: number;
      signals: string | null;
      scoreUpdatedAt: Date;
      reviewCreatedAt: Date;
    }>;
    total: number;
  }> {
    // The join is done via a raw SQL query for clarity (the alternative is
    // drizzle's relational query API, which is overkill for a single join
    // chain). The query is parameterized — no SQL injection.
    const db = this.drizzle.db;
    const rowsResult = await db.execute<{
      review_id: string;
      business_id: string;
      business_name: string;
      user_id: string;
      user_username: string;
      rating: number;
      body: string;
      review_status: string;
      score: number;
      signals: string | null;
      score_updated_at: Date;
      review_created_at: Date;
    }>(sql`
      SELECT
        r.id AS review_id,
        r.business_id,
        b.name AS business_name,
        r.user_id,
        u.username AS user_username,
        r.rating,
        r.body,
        r.status AS review_status,
        fs.score,
        fs.signals,
        fs.updated_at AS score_updated_at,
        r.created_at AS review_created_at
      FROM ai_fraud_scores fs
      JOIN reviews r ON r.id = fs.review_id
      JOIN businesses b ON b.id = r.business_id
      JOIN users u ON u.id = r.user_id
      WHERE fs.score >= ${minScore}
      ORDER BY fs.score DESC, fs.updated_at DESC, r.id
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const countResult = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM ai_fraud_scores fs
      WHERE fs.score >= ${minScore}
    `);
    const rows = (rowsResult.rows ?? []).map((r) => ({
      reviewId: r.review_id,
      businessId: r.business_id,
      businessName: r.business_name,
      userId: r.user_id,
      userUsername: r.user_username,
      rating: r.rating,
      body: r.body,
      reviewStatus: r.review_status,
      score: r.score,
      signals: r.signals,
      scoreUpdatedAt: r.score_updated_at,
      reviewCreatedAt: r.review_created_at,
    }));
    return { rows, total: countResult.rows[0]?.count ?? 0 };
  }
}
