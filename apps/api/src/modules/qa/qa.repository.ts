import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { businesses } from '../../db/schema/business.js';
import { users } from '../../db/schema/users.js';
import { businessAnswers, businessQuestions } from '../../db/schema/qa.js';
import type { QaStatus } from '@app/contracts';

/** DI token for the QA repository (tests bind a fake). */
export const QA_REPOSITORY = Symbol('QA_REPOSITORY');

/** Second join over `users` for the answer author's display name (a plain
 * self-join would collide with the asker join). */
const answerUsers = alias(users, 'answer_users');

/**
 * A question row joined with the asker identity + the (at most one) answer
 * and the answer author's display name — the exact shape every QA read
 * serves, so one join set renders the whole Q&A block.
 */
export interface QaQuestionWithMeta {
  id: string;
  businessId: string;
  userId: string;
  authorName: string | null;
  authorUsername: string;
  body: string;
  status: QaStatus;
  /** The owner answer, LEFT JOINed per read (null when unanswered). */
  answerId: string | null;
  answerUserId: string | null;
  answerAuthorName: string | null;
  answerBody: string | null;
  answerEditedAt: Date | null;
  answerCreatedAt: Date | null;
  answerUpdatedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** An answer row joined with the answerer's display name. */
export interface QaAnswerWithMeta {
  id: string;
  questionId: string;
  userId: string;
  authorName: string | null;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QaPage {
  items: QaQuestionWithMeta[];
  total: number;
}

/** The narrow fake-able surface consumed by QaService + the HTTP layer. */
export interface QaRepositoryLike {
  /** Existence + ownership + status of the business (404-never-leak and answer-authorization rules). */
  findBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
  } | null>;
  findQuestionById(questionId: string): Promise<QaQuestionWithMeta | null>;
  /** Approved-only, paginated business list (public). */
  listByBusiness(businessId: string, page: number, pageSize: number): Promise<QaPage>;
  /** Explicit-status list (the moderation view; also the per-business admin filter). */
  listByStatus(
    businessId: string,
    status: QaStatus,
    page: number,
    pageSize: number,
  ): Promise<QaPage>;
  /** Every-status list of the caller's own questions, newest first. */
  listByUser(userId: string, page: number, pageSize: number): Promise<QaPage>;
  insertQuestion(input: {
    businessId: string;
    userId: string;
    body: string;
  }): Promise<QaQuestionWithMeta>;
  /** Asker edit: rewrites the body, stamps edited_at + updated_at. */
  updateQuestion(questionId: string, body: string): Promise<QaQuestionWithMeta | null>;
  /** Hard delete (the answer cascades at the DB; the fake mirrors that). */
  deleteQuestion(questionId: string): Promise<boolean>;

  // ── B4.8 answers ─────────────────────────────────────────────────────────
  /** The question's answer (null when unanswered) with the answerer's display name. */
  findAnswerByQuestion(questionId: string): Promise<QaAnswerWithMeta | null>;
  /**
   * ONE statement: INSERT … ON CONFLICT (question_id) DO UPDATE — the first
   * call inserts (created_at = the passed timestamp), an edit rewrites body
   * + edited_at + updated_at in place (the original user_id/created_at are
   * provenance and never change). `created` is derived by comparing the
   * RETURNING created_at with the caller's insert timestamp — a conflicted
   * update keeps the ORIGINAL created_at, an insert the passed one.
   */
  upsertAnswer(input: {
    questionId: string;
    userId: string;
    body: string;
    /** The service's insert-time hint — the created/updated discriminator. */
    createdAt: Date;
  }): Promise<{ row: QaAnswerWithMeta; created: boolean }>;
  /** Remove the question's answer; false when there was none (idempotent DELETE). */
  deleteAnswer(questionId: string): Promise<boolean>;
}

const QUESTION_SELECT = {
  id: businessQuestions.id,
  businessId: businessQuestions.businessId,
  userId: businessQuestions.userId,
  authorName: users.displayName,
  authorUsername: users.username,
  body: businessQuestions.body,
  status: businessQuestions.status,
  // B4.8: the owner answer LEFT JOINed off `business_answers_one_per_question`
  // — at most one row per question, so the join cannot fan out the page.
  answerId: businessAnswers.id,
  answerUserId: businessAnswers.userId,
  answerAuthorName: answerUsers.displayName,
  answerBody: businessAnswers.body,
  answerEditedAt: businessAnswers.editedAt,
  answerCreatedAt: businessAnswers.createdAt,
  answerUpdatedAt: businessAnswers.updatedAt,
  editedAt: businessQuestions.editedAt,
  createdAt: businessQuestions.createdAt,
  updatedAt: businessQuestions.updatedAt,
};

/**
 * Q&A persistence (B4.8) over `business_questions`/`business_answers`
 * (migration 0027). Joins `users` twice (asker + answerer) for the
 * denormalised display names; URL-free content needs no media join.
 */
@Injectable()
export class QaRepository implements QaRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly client: DrizzleClient) {}

  async findBusinessContext(businessId: string): Promise<{
    ownerId: string | null;
    status: string;
    deletedAt: Date | null;
  } | null> {
    const rows = await this.client.db
      .select({
        ownerId: businesses.ownerId,
        status: businesses.status,
        deletedAt: businesses.deletedAt,
      })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The two LEFT JOINs every QUESTION_SELECT read needs (answer + its author). */
  private questionJoins() {
    return this.client.db
      .select(QUESTION_SELECT)
      .from(businessQuestions)
      .innerJoin(users, eq(users.id, businessQuestions.userId))
      .leftJoin(businessAnswers, eq(businessAnswers.questionId, businessQuestions.id))
      .leftJoin(answerUsers, eq(answerUsers.id, businessAnswers.userId));
  }

  async findQuestionById(questionId: string): Promise<QaQuestionWithMeta | null> {
    const rows = await this.questionJoins().where(eq(businessQuestions.id, questionId)).limit(1);
    return rows[0] ?? null;
  }

  /** Shared list builder: page slice + total count for the same WHERE. */
  private async list(where: SQL | undefined, page: number, pageSize: number): Promise<QaPage> {
    const items = await this.questionJoins()
      .where(where)
      .orderBy(desc(businessQuestions.createdAt), asc(businessQuestions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const totals = await this.client.db.select({ n: count() }).from(businessQuestions).where(where);
    return { items, total: totals[0]?.n ?? 0 };
  }

  async listByBusiness(businessId: string, page: number, pageSize: number): Promise<QaPage> {
    return this.list(
      and(eq(businessQuestions.businessId, businessId), eq(businessQuestions.status, 'approved')),
      page,
      pageSize,
    );
  }

  async listByStatus(
    businessId: string,
    status: QaStatus,
    page: number,
    pageSize: number,
  ): Promise<QaPage> {
    return this.list(
      and(eq(businessQuestions.businessId, businessId), eq(businessQuestions.status, status)),
      page,
      pageSize,
    );
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<QaPage> {
    return this.list(eq(businessQuestions.userId, userId), page, pageSize);
  }

  async insertQuestion(input: {
    businessId: string;
    userId: string;
    body: string;
  }): Promise<QaQuestionWithMeta> {
    const inserted = await this.client.db
      .insert(businessQuestions)
      .values({
        businessId: input.businessId,
        userId: input.userId,
        body: input.body,
      })
      .returning({ id: businessQuestions.id });
    const row = inserted[0];
    if (!row) throw new Error('business_questions insert returned no rows');
    const created = await this.findQuestionById(row.id);
    if (!created) throw new Error('business_questions insert vanished');
    return created;
  }

  async updateQuestion(questionId: string, body: string): Promise<QaQuestionWithMeta | null> {
    await this.client.db
      .update(businessQuestions)
      .set({ body, editedAt: new Date(), updatedAt: new Date() })
      .where(eq(businessQuestions.id, questionId));
    return this.findQuestionById(questionId);
  }

  async deleteQuestion(questionId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(businessQuestions)
      .where(eq(businessQuestions.id, questionId))
      .returning({ id: businessQuestions.id });
    return deleted.length > 0;
  }

  // ── B4.8 answers ─────────────────────────────────────────────────────────

  async findAnswerByQuestion(questionId: string): Promise<QaAnswerWithMeta | null> {
    const rows = await this.client.db
      .select({
        id: businessAnswers.id,
        questionId: businessAnswers.questionId,
        userId: businessAnswers.userId,
        authorName: answerUsers.displayName,
        body: businessAnswers.body,
        editedAt: businessAnswers.editedAt,
        createdAt: businessAnswers.createdAt,
        updatedAt: businessAnswers.updatedAt,
      })
      .from(businessAnswers)
      .leftJoin(answerUsers, eq(answerUsers.id, businessAnswers.userId))
      .where(eq(businessAnswers.questionId, questionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsertAnswer(input: {
    questionId: string;
    userId: string;
    body: string;
    createdAt: Date;
  }): Promise<{ row: QaAnswerWithMeta; created: boolean }> {
    const inserted = await this.client.db
      .insert(businessAnswers)
      .values({
        questionId: input.questionId,
        userId: input.userId,
        body: input.body,
        // The insert hint doubles as created_at AND updated_at; a conflicted
        // edit keeps the ORIGINAL created_at (see the interface contract).
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .onConflictDoUpdate({
        target: businessAnswers.questionId,
        set: { body: input.body, editedAt: new Date(), updatedAt: new Date() },
      })
      .returning({ createdAt: businessAnswers.createdAt });
    const returned = inserted[0];
    if (!returned) throw new Error('business_answers upsert returned no rows');
    const created = returned.createdAt.getTime() === input.createdAt.getTime();
    const row = await this.findAnswerByQuestion(input.questionId);
    if (!row) throw new Error('business answer vanished after upsert');
    return { row, created };
  }

  async deleteAnswer(questionId: string): Promise<boolean> {
    const deleted = await this.client.db
      .delete(businessAnswers)
      .where(eq(businessAnswers.questionId, questionId))
      .returning({ id: businessAnswers.id });
    return deleted.length > 0;
  }
}
