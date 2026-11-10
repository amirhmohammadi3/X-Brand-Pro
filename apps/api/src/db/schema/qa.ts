import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { businesses } from './business.js';
import { users } from './users.js';

/**
 * Business Q&A (B4.8). A user asks a question about a business; the owner
 * answers. Two tables, mirroring the reviews/review_replies split:
 *
 * - `business_questions` — the asker's content. NO one-question-per-user
 *   rule (unlike reviews): questions are distinct inquiries, so a user may
 *   ask several; abuse is bounded by the ask rate limit (10/hour, B4.8)
 *   instead of a uniqueness constraint. The `qa_status` enum mirrors
 *   `review_status` so the future moderation/spam prompts can flip rows
 *   without a migration; only `approved` rows are publicly served.
 * - `business_answers` — the owner's (or a `businesses.manage` holder's)
 *   reply. ONE answer per question (`business_answers_one_per_question`
 *   unique on question_id): a second PUT is an in-place edit of the same
 *   row, never a thread — the same semantics as B4.3 review replies.
 *
 * Both FKs cascade: a deleted business or user takes their questions and
 * answers with them (a deleted question cascades its answer — an answer
 * must never outlive the question it responds to).
 */
export const qaStatusEnum = pgEnum('qa_status', ['approved', 'pending', 'rejected']);

export const businessQuestions = pgTable(
  'business_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    status: qaStatusEnum('status').notNull().default('approved'),
    /** Stamped by the service when the asker edits the question after creation. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Business page list: approved questions, newest first (id is the stable tiebreak).
    index('business_questions_business_list_idx').on(
      table.businessId,
      table.status,
      table.createdAt.desc(),
      table.id,
    ),
    // "My questions" (GET /questions/me): newest first per user.
    index('business_questions_user_idx').on(table.userId, table.createdAt.desc()),
    // Future moderation queue: oldest-pending-first triage (mirrors
    // reviews_status_created_idx from B4.1).
    index('business_questions_status_created_idx').on(table.status, table.createdAt.asc()),
    check('business_questions_body_len', sql`char_length(${table.body}) BETWEEN 10 AND 500`),
  ],
);

export type BusinessQuestionRow = typeof businessQuestions.$inferSelect;
export type NewBusinessQuestionRow = typeof businessQuestions.$inferInsert;

export const businessAnswers = pgTable(
  'business_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => businessQuestions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    /** Stamped by the service when an allowed caller edits the answer. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // ONE answer per question — the upsert target AND the business-page join
    // key (every question-list read LEFT JOINs this index; at most one row
    // per question, so the join cannot fan out the page).
    uniqueIndex('business_answers_one_per_question').on(table.questionId),
    // The answerer's own answers (moderation takedowns, owner handover views).
    index('business_answers_user_idx').on(table.userId, table.createdAt.desc()),
    check('business_answers_body_len', sql`char_length(${table.body}) BETWEEN 2 AND 1000`),
  ],
);

export type BusinessAnswerRow = typeof businessAnswers.$inferSelect;
export type NewBusinessAnswerRow = typeof businessAnswers.$inferInsert;
