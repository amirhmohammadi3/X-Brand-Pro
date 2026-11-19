import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { reviews } from './reviews.js';

/**
 * AI fraud/toxicity scores (A9.6). One row per review — a 0..1 score + a
 * list of signals + the model/driver that produced the score. The score
 * is generated when a review is created (the subscriber enqueues a
 * generate), and regenerated when the review body is edited.
 *
 * Lifecycle:
 *  - review.created → enqueue a generate (debounced 60s).
 *  - review.updated → mark stale (the next moderation-queue read regen).
 *  - review.deleted → FK cascades the row away.
 *
 * The moderation queue reads the score column to surface high-risk
 * reviews (the queue sorts by score DESC). The score is computed by the
 * rule driver (deterministic) by default, or by the LLM driver if
 * configured (a more nuanced classification). Both paths return the same
 * wire shape.
 *
 * The score column is `double precision` (PostgreSQL float8) — 0..1 with
 * ~15 digits of precision, more than enough for a heuristic. The signals
 * column is a short text (one comma-separated list, e.g. "long_body,
 * all_caps, blocked_word") — kept simple to avoid a JSON column.
 */
export const aiFraudScores = pgTable(
  'ai_fraud_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    /** The 0..1 fraud/toxicity score (0 = benign, 1 = high-risk). */
    score: doublePrecision('score').notNull(),
    /** The driver that produced the score (fake / openai / rule). */
    driver: varchar('driver', { length: 20 }).notNull(),
    /** The model id (or rule-fa-v1). */
    model: varchar('model', { length: 100 }),
    /** The prompt version (matches ai.prompts.fraudToxicity.version). */
    promptVersion: integer('prompt_version').notNull().default(1),
    /** True when the review body changed + a regenerate is pending. */
    stale: boolean('stale').notNull().default(false),
    /** The signals the driver detected (comma-separated, e.g. "long_body,all_caps"). */
    signals: text('signals'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** The error code from the last generation (null on success). */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One score per review.
    uniqueIndex('ai_fraud_scores_review_uniq').on(table.reviewId),
    // The moderation queue sorts by score DESC.
    index('ai_fraud_scores_score_idx').on(table.score.desc()),
    // Per-prompt-version stale detection.
    index('ai_fraud_scores_version_idx').on(table.promptVersion),
    check('ai_fraud_scores_score_range', sql`${table.score} BETWEEN 0 AND 1`),
  ],
);

export type AiFraudScoreRow = typeof aiFraudScores.$inferSelect;
export type NewAiFraudScoreRow = typeof aiFraudScores.$inferInsert;
