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
import { businessQuestions } from './qa.js';

/**
 * AI FAQ answers (A9.4). One row per question — the AI's draft answer the
 * owner can publish (with an AI label) or dismiss. The owner publishes
 * through the EXISTING `business_answers` table (so the published answer
 * flows through the normal Q&A page); this table is only the DRAFT pool.
 *
 * Lifecycle:
 *  - A new question is created → the subscriber enqueues an AI draft
 *    generate (debounced 60s, same pattern as A9.3).
 *  - The draft generate reads the question + the business context (name +
 *    category + a few recent reviews for grounding) and calls
 *    AiService.complete({feature:'faq_auto_answer'}). The text is stored
 *    here with `published: false`.
 *  - The owner views the question page → sees the draft + a "publish as
 *    AI answer" button.
 *  - On publish, the owner's call goes through the existing answer-create
 *    endpoint with `aiGenerated: true` flag (a new column on
 *    business_answers — but we DON'T add a column; instead, the publish
 *    endpoint creates the answer row + sets a flag we track here).
 *
 * For simplicity + to avoid touching the existing business_answers schema,
 * the `published` flag here is the source of truth: the owner publishes
 * the AI draft by POSTing to /businesses/:id/questions/:qid/ai-answer/
 * publish, which creates a business_answer row (with the AI text) and
 * flips `published: true` here. The Q&A list endpoint joins this table
 * to add `aiGenerated: true` on matching answers.
 *
 * The unique index on question_id means at most one draft per question.
 */
export const aiFaqAnswers = pgTable(
  'ai_faq_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => businessQuestions.id, { onDelete: 'cascade' }),
    /** The AI draft text (Persian). Null only between row create + first generation. */
    draft: text('draft').notNull(),
    /** The driver that produced the draft (fake / openai / rule). */
    driver: varchar('driver', { length: 20 }).notNull(),
    /** The model id (or rule-fa-v1). */
    model: varchar('model', { length: 100 }),
    /** The prompt version (matches ai.prompts.faqAnswer.version). */
    promptVersion: integer('prompt_version').notNull().default(1),
    /** True when the owner has published the draft as a business_answer. */
    published: boolean('published').notNull().default(false),
    /** True when the owner dismissed the draft (it won't show again unless regenerated). */
    dismissed: boolean('dismissed').notNull().default(false),
    /** True when the question changed + a regenerate is pending. */
    stale: boolean('stale').notNull().default(false),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** The error code from the last generation (null on success). */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One draft per question.
    uniqueIndex('ai_faq_answers_question_uniq').on(table.questionId),
    // The owner's "drafts to review" list filters unpublished + undismissed.
    index('ai_faq_answers_review_idx').on(table.published, table.dismissed, table.updatedAt),
    // Per-prompt-version stale detection.
    index('ai_faq_answers_version_idx').on(table.promptVersion),
  ],
);

export type AiFaqAnswerRow = typeof aiFaqAnswers.$inferSelect;
export type NewAiFaqAnswerRow = typeof aiFaqAnswers.$inferInsert;
