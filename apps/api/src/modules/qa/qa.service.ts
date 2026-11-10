import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
// Value import (not type-only): Nest reads the constructor parameter type at
// runtime via emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  CreateQaQuestionBody,
  DeleteQaAnswerResult,
  DeleteQaQuestionResult,
  MyQaQuestionsResult,
  QaListResult,
  QaQuestion,
  QaAnswer,
  UpdateQaQuestionBody,
  UpsertQaAnswerBody,
  UpsertQaAnswerResult,
} from '@app/contracts';
import { canManageBusiness, type BusinessActor } from '../business/business-access.js';
import { roleHasPermissions } from '../users/users.service.js';
import {
  QA_REPOSITORY,
  type QaAnswerWithMeta,
  type QaQuestionWithMeta,
  type QaRepositoryLike,
} from './qa.repository.js';

/**
 * Domain events (AGENTS.md 6). Hooks for the future notification and
 * moderation prompts — nothing subscribes yet (B4.8 scope).
 */
export const QA_EVENTS = {
  created: 'question.created',
  updated: 'question.updated',
  deleted: 'question.deleted',
  /** The business posted the FIRST answer to a question. */
  answered: 'question.answered',
  /** An existing answer was edited (upsert hit the conflict branch). */
  answerUpdated: 'question.answer.updated',
  /** An answer was removed (owner, answer author or moderator takedown). */
  answerDeleted: 'question.answer.deleted',
} as const;

/**
 * Permission that may delete (take down) any question — the SAME
 * user-content moderation permission the B4.4 review queue uses
 * (`reviews.manage`, held by moderator/admin/super_admin in
 * ROLE_PERMISSIONS). Reused instead of minting a parallel `qa.manage` key:
 * content triage is one job, one permission.
 */
export const QA_MANAGE_PERMISSION = 'reviews.manage';

function notFoundException(what: string, id: string): HttpException {
  return new HttpException(
    {
      code: 'NOT_FOUND' as const,
      messageKey: 'errors.not_found',
      message: `${what} ${id} not found`,
      details: { entity: what.toLowerCase(), id },
    },
    HttpStatus.NOT_FOUND,
  );
}

function forbiddenException(message: string): HttpException {
  return new HttpException(
    { code: 'FORBIDDEN' as const, messageKey: 'errors.forbidden', message },
    HttpStatus.FORBIDDEN,
  );
}

function ruleException(message: string, details?: unknown): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message,
      details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

/**
 * Business Q&A (B4.8). Rules:
 * - the business must exist and not be soft-deleted (404, never leaking
 *   existence) and be `active` to ACCEPT a new question (422);
 * - NO one-question-per-user rule — questions are distinct inquiries; the
 *   ask rate limit (10/hour, fail-closed) bounds abuse instead;
 * - question edit is ASKER-only; question delete is asker OR
 *   `reviews.manage` (takedown; the answer cascades);
 * - the answer speaks for the BUSINESS: only the owner (`businesses.owner_id`
 *   match via `canManageBusiness`, the same helper as every B2.x manage
 *   endpoint) or a `businesses.manage` holder may write it; a `reviews.manage`
 *   moderator may TAKEDOWN an answer but never write one (moderation
 *   moderates, it never speaks as the business — the B4.3 reply rule);
 * - answers apply to APPROVED questions only — pending/rejected are
 *   invisible on the public page, so they cannot be answered (422);
 * - ONE answer per question (unique index) — a second PUT is an in-place
 *   edit (`created: false`), never a thread;
 * - every write emits a domain event.
 */
@Injectable()
export class QaService {
  constructor(
    @Inject(QA_REPOSITORY) private readonly repo: QaRepositoryLike,
    private readonly events: EventEmitter2,
  ) {}

  /** Public business page list: approved questions, newest first, paginated. */
  async listByBusiness(
    businessId: string,
    query: { page: number; pageSize: number; status?: 'approved' | 'pending' | 'rejected' },
  ): Promise<QaListResult> {
    const page =
      query.status === undefined
        ? await this.repo.listByBusiness(businessId, query.page, query.pageSize)
        : await this.repo.listByStatus(businessId, query.status, query.page, query.pageSize);
    return {
      items: page.items.map((row) => this.toQuestion(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  /** The caller's own questions (every status), newest first. */
  async listMine(
    userId: string,
    query: { page: number; pageSize: number },
  ): Promise<MyQaQuestionsResult> {
    const page = await this.repo.listByUser(userId, query.page, query.pageSize);
    return {
      items: page.items.map((row) => this.toQuestion(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
    };
  }

  async create(
    businessId: string,
    user: BusinessActor,
    input: CreateQaQuestionBody,
  ): Promise<QaQuestion> {
    const business = await this.repo.findBusinessContext(businessId);
    if (!business || business.deletedAt) {
      throw notFoundException('Business', businessId);
    }
    if (business.status !== 'active') {
      throw ruleException('Only active businesses accept questions', {
        businessId,
        status: business.status,
      });
    }
    const row = await this.repo.insertQuestion({
      businessId,
      userId: user.id,
      body: input.body,
    });
    this.events.emit(QA_EVENTS.created, {
      questionId: row.id,
      businessId,
      userId: user.id,
    });
    return this.toQuestion(row);
  }

  /** Asker-only edit of the wording. An existing answer still refers to the question. */
  async update(
    questionId: string,
    user: BusinessActor,
    input: UpdateQaQuestionBody,
  ): Promise<QaQuestion> {
    const row = await this.repo.findQuestionById(questionId);
    if (!row) throw notFoundException('Question', questionId);
    if (row.userId !== user.id) {
      throw forbiddenException('Only the asker may edit this question');
    }
    const updated = await this.repo.updateQuestion(questionId, input.body);
    if (!updated) throw notFoundException('Question', questionId);
    this.events.emit(QA_EVENTS.updated, {
      questionId,
      businessId: updated.businessId,
      userId: user.id,
    });
    return this.toQuestion(updated);
  }

  /**
   * Remove the question (asker or `reviews.manage` takedown). The answer is
   * cascade-deleted with it — an unowned answer must never outlive the
   * question it answers.
   */
  async remove(questionId: string, user: BusinessActor): Promise<DeleteQaQuestionResult> {
    const row = await this.repo.findQuestionById(questionId);
    if (!row) throw notFoundException('Question', questionId);
    const isAsker = row.userId === user.id;
    const isModerator = roleHasPermissions(user.role as never, [QA_MANAGE_PERMISSION]);
    if (!isAsker && !isModerator) {
      throw forbiddenException('Only the asker or a moderator may delete this question');
    }
    const deleted = await this.repo.deleteQuestion(questionId);
    if (deleted) {
      this.events.emit(QA_EVENTS.deleted, {
        questionId,
        businessId: row.businessId,
        userId: user.id,
      });
    }
    return { deleted };
  }

  // ── B4.8 answers ─────────────────────────────────────────────────────────

  /**
   * The answer-authorization gate shared by upsert and delete. Who may speak
   * for a business: the OWNER (`businesses.owner_id` match, owner-editable
   * status — `canManageBusiness`) or a `businesses.manage` holder. A
   * `reviews.manage` moderator is deliberately NOT an answerer (see the
   * class rules); it may only takedown via removeAnswer.
   */
  private async assertAnswerAccess(businessId: string, user: BusinessActor): Promise<void> {
    const business = await this.repo.findBusinessContext(businessId);
    if (!business || business.deletedAt) {
      // Never leak the business behind a question id (the 404-never-leak rule).
      throw notFoundException('Business', businessId);
    }
    if (!canManageBusiness(user, { ownerId: business.ownerId, status: business.status as never })) {
      throw forbiddenException('Only the business owner may answer questions for this business');
    }
  }

  /**
   * Create or edit the ONE business answer (upsert semantics — the unique
   * `business_answers_one_per_question` makes a second PUT an in-place edit
   * of the same row, never a thread). Rules:
   * - the question must exist (404) and be APPROVED — pending/rejected are
   *   invisible on the public page, so they cannot be answered (422);
   * - the caller must manage the question's business (403 — see
   *   assertAnswerAccess);
   * - an existing answer's authorship is PROVENANCE (user_id/created_at stay
   *   the original answerer's — an ownership transfer does not rewrite
   *   history); the new body + edited_at are what the edit changes.
   * Emits `question.answered` on the first answer, `question.answer.updated`
   * on an edit — hooks for the future notification prompts.
   */
  async upsertAnswer(
    questionId: string,
    user: BusinessActor,
    input: UpsertQaAnswerBody,
  ): Promise<UpsertQaAnswerResult> {
    const row = await this.repo.findQuestionById(questionId);
    if (!row) throw notFoundException('Question', questionId);
    if (row.status !== 'approved') {
      throw ruleException('Only approved questions accept answers', {
        questionId,
        status: row.status,
      });
    }
    await this.assertAnswerAccess(row.businessId, user);
    const { row: answer, created } = await this.repo.upsertAnswer({
      questionId,
      userId: user.id,
      body: input.body,
      createdAt: new Date(),
    });
    this.events.emit(created ? QA_EVENTS.answered : QA_EVENTS.answerUpdated, {
      questionId,
      businessId: row.businessId,
      answerId: answer.id,
      userId: user.id,
    });
    return { answer: this.toAnswer(answer), created };
  }

  /**
   * Remove the question's answer. Allowed: the business owner/manage holder
   * (assertAnswerAccess), the answer's own author (e.g. after an ownership
   * transfer they no longer manage the business but their answer is still
   * theirs) or a `reviews.manage` moderator (takedown). Idempotent when no
   * answer exists — `{ deleted: false }`, never a 404 (a double-tap on the
   * remove button must not error; the unknown QUESTION is still 404).
   */
  async removeAnswer(questionId: string, user: BusinessActor): Promise<DeleteQaAnswerResult> {
    const row = await this.repo.findQuestionById(questionId);
    if (!row) throw notFoundException('Question', questionId);
    const answer = await this.repo.findAnswerByQuestion(questionId);
    if (!answer) return { deleted: false };
    const isAnswerAuthor = answer.userId === user.id;
    const isModerator = roleHasPermissions(user.role as never, [QA_MANAGE_PERMISSION]);
    if (!isAnswerAuthor && !isModerator) {
      await this.assertAnswerAccess(row.businessId, user);
    }
    const deleted = await this.repo.deleteAnswer(questionId);
    if (deleted) {
      this.events.emit(QA_EVENTS.answerDeleted, {
        questionId,
        businessId: row.businessId,
        answerId: answer.id,
        userId: user.id,
      });
    }
    return { deleted };
  }

  /** Map a joined row to the contract shape. */
  private toQuestion(row: QaQuestionWithMeta): QaQuestion {
    return {
      id: row.id,
      businessId: row.businessId,
      userId: row.userId,
      authorName: row.authorName,
      authorUsername: row.authorUsername,
      body: row.body,
      status: row.status,
      answer: row.answerId && row.answerBody ? this.toAnswerFromJoin(row) : null,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The answer DTO off the question row's LEFT-JOIN columns. */
  private toAnswerFromJoin(row: QaQuestionWithMeta): QaAnswer {
    return {
      id: row.answerId as string,
      questionId: row.id,
      userId: row.answerUserId as string,
      authorName: row.answerAuthorName,
      body: row.answerBody as string,
      editedAt: row.answerEditedAt ? row.answerEditedAt.toISOString() : null,
      createdAt: (row.answerCreatedAt as Date).toISOString(),
      updatedAt: (row.answerUpdatedAt as Date).toISOString(),
    };
  }

  /** The answer DTO off a dedicated answer row (the upsert/remove responses). */
  private toAnswer(row: QaAnswerWithMeta): QaAnswer {
    return {
      id: row.id,
      questionId: row.questionId,
      userId: row.userId,
      authorName: row.authorName,
      body: row.body,
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
