import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * AI module (Phase 9). Two tables back the driver abstraction (A9.1):
 *
 * - `ai_calls` — one row per driver call. Carries the feature (so the
 *   admin can break down cost), the driver + model that actually answered
 *   (the rule driver on fallback), the token counts (debited against the
 *   monthly budget), the latency, the success flag + error code, and a
 *   redacted-truncated prompt+completion excerpt (200 chars each — the
 *   full text is never stored; the prompt is personal data, the
 *   completion may quote a user review). The monthly budget spend is
 *   derived: `SELECT SUM(prompt_tokens + completion_tokens) FROM ai_calls
 *   WHERE ok AND created_at >= date_trunc('month', now())`.
 *
 *   There is NO update path: the row is insert-only (an audit trail of
 *   every AI call the platform made). Cleanup, if ever needed, is a
 *   future retention job (Q12.10) — the table is sized for ~10k rows /
 *   month.
 *
 * The `ai_call_feature` / `ai_call_driver` / `ai_call_error_code` enums
 * are the same closed sets the contract exposes; the schema guards the
 * data domain, the service guards the rules.
 */

/** The features that may call the driver (mirrors AI_FEATURES). */
export const aiCallFeatureEnum = pgEnum('ai_call_feature', [
  'review_summary',
  'faq_auto_answer',
  'recommendation',
  'fraud_toxicity',
  'admin_test',
]);

/** The drivers the API ships (mirrors AI_DRIVER_NAMES). */
export const aiCallDriverEnum = pgEnum('ai_call_driver', ['fake', 'openai', 'rule']);

/** The error codes a driver result may carry (mirrors AI_ERROR_CODES). */
export const aiCallErrorCodeEnum = pgEnum('ai_call_error_code', [
  'AI_DISABLED',
  'AI_BUDGET_EXHAUSTED',
  'AI_DRIVER_FAILED',
  'AI_INVALID_RESPONSE',
  'AI_NO_CREDENTIALS',
]);

export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The feature that triggered the call (for cost breakdown + filters). */
    feature: aiCallFeatureEnum('feature').notNull(),
    /** The driver that actually answered (the rule driver on fallback). */
    driver: aiCallDriverEnum('driver').notNull(),
    /** The model id (e.g. `gpt-4o-mini`, `rule-fa-v1`); null on the fake driver. */
    model: varchar('model', { length: 100 }),
    /** Whether the call succeeded (the feature falls back to A9.2 on false). */
    ok: boolean('ok').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Wall-clock latency in ms (for the log + the admin panel). */
    latencyMs: integer('latency_ms').notNull().default(0),
    /** Present when ok:false — the caller branches on this. */
    errorCode: aiCallErrorCodeEnum('error_code'),
    errorMessage: text('error_message'),
    /** First 200 chars of the prompt (context only; never the full text). */
    promptExcerpt: text('prompt_excerpt').notNull(),
    /** First 200 chars of the completion (or the error message). */
    completionExcerpt: text('completion_excerpt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Admin panel listing: newest first.
    index('ai_calls_created_idx').on(table.createdAt.desc(), table.id),
    // Monthly budget spend: `SUM(prompt+completion) WHERE ok AND created_at >= month_start`.
    index('ai_calls_monthly_spend_idx').on(table.ok, table.createdAt.desc()),
    // Per-feature breakdown (the admin cost chart).
    index('ai_calls_feature_idx').on(table.feature, table.createdAt.desc()),
    // Per-driver breakdown.
    index('ai_calls_driver_idx').on(table.driver, table.createdAt.desc()),
    check('ai_calls_prompt_tokens_nonneg', sql`${table.promptTokens} >= 0`),
    check('ai_calls_completion_tokens_nonneg', sql`${table.completionTokens} >= 0`),
    check('ai_calls_latency_nonneg', sql`${table.latencyMs} >= 0`),
    // ok=false ⇒ errorCode must be set; ok=true ⇒ errorCode must be null.
    check(
      'ai_calls_ok_error_consistency',
      sql`(${table.ok} AND ${table.errorCode} IS NULL) OR (NOT ${table.ok} AND ${table.errorCode} IS NOT NULL)`,
    ),
    check(
      'ai_calls_prompt_excerpt_len',
      sql`char_length(${table.promptExcerpt}) BETWEEN 1 AND 200`,
    ),
    check(
      'ai_calls_completion_excerpt_len',
      sql`char_length(${table.completionExcerpt}) BETWEEN 1 AND 200`,
    ),
    check(
      'ai_calls_error_message_len',
      sql`${table.errorMessage} IS NULL OR char_length(${table.errorMessage}) BETWEEN 1 AND 1000`,
    ),
  ],
);

export type AiCallRow = typeof aiCalls.$inferSelect;
export type NewAiCallRow = typeof aiCalls.$inferInsert;
