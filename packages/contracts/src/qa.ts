import { z } from 'zod';
import { pageQuerySchema, pageMetaSchema } from './pagination.js';
import { uuidSchema } from './primitives.js';

/**
 * Business Q&A (B4.8). Any authenticated user asks a question about an
 * ACTIVE business; the business owner (or a `businesses.manage` holder)
 * answers with ONE answer per question — the unique index
 * `business_answers_one_per_question` makes a second PUT an in-place EDIT
 * of the same answer (the same upsert semantics as the B4.3 owner reply),
 * never a thread. Unlike reviews there is NO one-question-per-user rule —
 * questions are distinct inquiries, not sentiment statements; abuse is
 * bounded by the ask rate limit instead.
 *
 * Lifecycle mirrors reviews: rows are created `approved`; `pending`/`
 * rejected` are reserved for the future moderation prompts to flip into
 * without a migration. Only `approved` questions are served on the public
 * business page (with their answer joined inline, so one read renders the
 * whole Q&A block).
 */

export const QA_STATUSES = ['approved', 'pending', 'rejected'] as const;
export const qaStatusSchema = z.enum(QA_STATUSES);
export type QaStatus = (typeof QA_STATUSES)[number];

export const QA_QUESTION_BODY_MIN = 10;
export const QA_QUESTION_BODY_MAX = 500;
export const QA_ANSWER_BODY_MIN = 2;
export const QA_ANSWER_BODY_MAX = 1000;

/**
 * Rate-limit rules (single source of truth for controller + tests):
 * - asking is the high-abuse write (public-facing content creation) →
 *   10 questions per hour per user, fail-closed like review creation;
 * - answers/edits/deletes are owner-speed writes → 30/min per user;
 * - public list reads → 60/min per ip.
 */
export const QA_ASK_LIMIT_PER_HOUR = 10;
export const QA_WRITE_LIMIT_PER_MIN = 30;
export const QA_READ_LIMIT_PER_MIN = 60;

/** One owner answer as served inside a Question. */
export const qaAnswerSchema = z.object({
  id: uuidSchema,
  questionId: uuidSchema,
  /** The answerer at write time — provenance only (an ownership transfer does NOT block further edits). */
  userId: uuidSchema,
  /** Answerer's public display name (users.display_name at read time). */
  authorName: z.string().min(1).nullable(),
  body: z.string().min(QA_ANSWER_BODY_MIN).max(QA_ANSWER_BODY_MAX),
  /** Stamped when an allowed caller edits the answer after creation. */
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QaAnswer = z.infer<typeof qaAnswerSchema>;

/** One question (with its answer, when answered) as served by the QA endpoints. */
export const qaQuestionSchema = z.object({
  id: uuidSchema,
  businessId: uuidSchema,
  userId: uuidSchema,
  /** Asker's public display name (denormalised for the list). */
  authorName: z.string().min(1).nullable(),
  /** Asker's username — always present; the UI falls back to it when displayName is null. */
  authorUsername: z.string().min(3),
  body: z.string().min(QA_QUESTION_BODY_MIN).max(QA_QUESTION_BODY_MAX),
  status: qaStatusSchema,
  /** The owner's answer — null until the business answers. */
  answer: qaAnswerSchema.nullable(),
  /** Set when the asker edited the question after creation. */
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QaQuestion = z.infer<typeof qaQuestionSchema>;

/** POST /businesses/:id/questions body. */
export const createQaQuestionBodySchema = z
  .object({ body: z.string().min(QA_QUESTION_BODY_MIN).max(QA_QUESTION_BODY_MAX) })
  .strict();
export type CreateQaQuestionBody = z.infer<typeof createQaQuestionBodySchema>;

/**
 * PATCH /questions/:id body — the asker may refine the wording. Editing an
 * ANSWERED question is allowed (the answer still refers to it; the owner can
 * edit or withdraw their answer at any time).
 */
export const updateQaQuestionBodySchema = z
  .object({ body: z.string().min(QA_QUESTION_BODY_MIN).max(QA_QUESTION_BODY_MAX) })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateQaQuestionBody = z.infer<typeof updateQaQuestionBodySchema>;

/** PUT /questions/:id/answer body. */
export const upsertQaAnswerBodySchema = z
  .object({ body: z.string().min(QA_ANSWER_BODY_MIN).max(QA_ANSWER_BODY_MAX) })
  .strict();
export type UpsertQaAnswerBody = z.infer<typeof upsertQaAnswerBodySchema>;

/** Public list query (business page). `status` filter is moderation-only. */
export const qaListQuerySchema = pageQuerySchema.extend({
  status: qaStatusSchema.optional(),
});
export type QaListQuery = z.infer<typeof qaListQuerySchema>;

/** Page-based question list (public business page and "my questions"). */
export const qaListResultSchema = z.object({
  items: z.array(qaQuestionSchema),
  meta: pageMetaSchema,
});
export type QaListResult = z.infer<typeof qaListResultSchema>;
export type MyQaQuestionsResult = QaListResult;

/** Upsert semantics: `created` distinguishes the first answer from an edit. */
export const upsertQaAnswerResultSchema = z.object({
  answer: qaAnswerSchema,
  created: z.boolean(),
});
export type UpsertQaAnswerResult = z.infer<typeof upsertQaAnswerResultSchema>;

/**
 * DELETE /questions/:id (the asker or a moderator — the answer cascades)
 * and DELETE /questions/:id/answer (idempotent — no answer → `{ deleted:
 * false }`, mirroring the B4.3 reply removal).
 */
export const deleteQaQuestionResultSchema = z.object({ deleted: z.boolean() });
export type DeleteQaQuestionResult = z.infer<typeof deleteQaQuestionResultSchema>;
export const deleteQaAnswerResultSchema = z.object({ deleted: z.boolean() });
export type DeleteQaAnswerResult = z.infer<typeof deleteQaAnswerResultSchema>;
