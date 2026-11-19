import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { businesses } from './business.js';

/**
 * AI review summaries (Phase 9, A9.3). One row per business, regenerated
 * on the review-summary queue when:
 *  - a review is created / approved (review.created, review.status.changed
 *    → approved);
 *  - a review is edited (review.updated);
 *  - a review is deleted (review.deleted);
 *  - an admin clicks the "regenerate" button (POST /admin/businesses/:id/
 *    ai-summary/regenerate);
 *  - the prompt template changes (the admin bumps `ai.prompts.reviewSummary
 *    .version` — old summaries are detected as stale by version mismatch).
 *
 * The summary row stores:
 *  - the generated text (Persian; the rule driver produces a short phrase
 *    with count + average; the LLM driver produces a 2-3 sentence summary);
 *  - the prompt version (so the admin can change the prompt and stale
 *    summaries are regenerated lazily on next read);
 *  - the model + driver that actually produced the text (for the audit
 *    trail + the cost breakdown);
 *  - the token counts (already debited against the monthly budget via
 *    the ai_calls log; duplicated here for the summary's own row).
 *  - `stale` flag — set true when a review changes; the next read shows
 *    the stale summary (so the page is never empty) and enqueues a
 *    regenerate job (debounced: only one job per business per minute).
 *
 * The unique index on business_id means at most one summary per business —
 * regenerate is an UPSERT, never an insert-cascade.
 */
export const aiReviewSummaries = pgTable(
  'ai_review_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** The summary text (Persian). Null only between the row create + the first generation. */
    summary: text('summary').notNull(),
    /** The driver that actually answered (fake / openai / rule). */
    driver: varchar('driver', { length: 20 }).notNull(),
    /** The model id (or `rule-fa-v1` on the rule driver; null on fake). */
    model: varchar('model', { length: 100 }),
    /** The prompt version (matches ai.prompts.reviewSummary.version). */
    promptVersion: integer('prompt_version').notNull().default(1),
    /** True when a review changed but the regenerate job has not run yet. */
    stale: boolean('stale').notNull().default(false),
    /** Tokens debited for this summary (also recorded in ai_calls). */
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Review snapshot at generation time (count + avg rating, for the "based on N reviews" line). */
    reviewCount: integer('review_count').notNull().default(0),
    reviewAvgRating: integer('review_avg_rating'), // 0..500 (×100 to keep integer)
    /** The error code from the last generation (null on success). */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One summary per business.
    uniqueIndex('ai_review_summaries_business_uniq').on(table.businessId),
    // The stale-regenerate sweep picks stale rows older than the debounce.
    index('ai_review_summaries_stale_idx').on(table.stale, table.updatedAt),
    // Per-prompt-version stale detection.
    index('ai_review_summaries_version_idx').on(table.promptVersion),
  ],
);

export type AiReviewSummaryRow = typeof aiReviewSummaries.$inferSelect;
export type NewAiReviewSummaryRow = typeof aiReviewSummaries.$inferInsert;
