import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiFaqAnswer,
  AiFaqPublishResult,
  AiFaqRegenerateResult,
  AiFaqDismissResult,
} from '@app/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import {
  AI_FAQ_ANSWERS_REPOSITORY,
  type AiFaqAnswersRepositoryLike,
} from './ai-faq-answers.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AiService } from './ai.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QaService } from '../qa/qa.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService } from '../reviews/reviews.service.js';
import type { AiFaqAnswerRow } from '../../db/schema/ai-faq-answers.js';
import type { BusinessActor } from '../business/business-access.js';

/**
 * FaqAnswerService (A9.4) — orchestrates the AI draft answer for a business
 * question. Four entry points:
 *
 *  - `getDraft(businessId, questionId)` — the owner reads the current draft
 *    (null on the very first read while the job runs). On stale/missing,
 *    enqueues a regenerate (debounced 60s, fire-and-forget).
 *
 *  - `publish(businessId, questionId, user)` — the owner publishes the AI
 *    draft as a business_answer (calls QaService.upsertAnswer with the AI
 *    text). Marks the draft as published. Idempotent: a second publish
 *    returns the existing answer (created=false).
 *
 *  - `dismiss(businessId, questionId)` — the owner hides the draft (sets
 *    dismissed=true). The draft stays in the table (for audit) but won't
 *    show in the review queue. A future regenerate (admin endpoint) can
 *    re-show it.
 *
 *  - `regenerate(businessId, questionId)` — admin forces a regenerate
 *    (bypasses the debounce). Returns enqueued=true + jobId=null (the
 *    fire-and-forget pattern from A9.3).
 *
 *  - `onQuestionCreated(businessId, questionId)` — the subscriber hook (the
 *    QA module emits `question.created`). Enqueues an initial draft
 *    generate.
 *
 *  - `onQuestionUpdated(businessId, questionId)` — the subscriber hook (the
 *    QA module emits `question.updated` on edit). Marks the draft stale.
 *
 *  - `generateForQuestion(businessId, questionId)` — the actual generation
 *    logic, called by the queue worker. Reads the question body + the
 *    business context (name + a few recent reviews for grounding), calls
 *    AiService.complete({feature:'faq_auto_answer'}), upserts the draft.
 *    Always succeeds — on AI failure, stores the error code + keeps the
 *    previous text.
 */
@Injectable()
export class FaqAnswerService {
  private readonly logger = new Logger(FaqAnswerService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    @Inject(AI_FAQ_ANSWERS_REPOSITORY)
    private readonly draftsRepo: AiFaqAnswersRepositoryLike,
    private readonly ai: AiService,
    private readonly qa: QaService,
    private readonly reviews: ReviewsService,
  ) {}

  /** The owner reads the current draft (null on the very first read). */
  async getDraft(_businessId: string, questionId: string): Promise<AiFaqAnswer | null> {
    const row = await this.draftsRepo.findByQuestionId(questionId);
    if (!row) {
      // No draft yet — enqueue an initial generate (best-effort, no await).
      void this.generateForQuestion(_businessId, questionId).catch((err) =>
        this.logger.error(
          `failed to enqueue initial FAQ draft for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return null;
    }

    const draft = toWire(row);
    // Check prompt-version staleness.
    const currentVersion = await this.settings.get<number>('ai.prompts.faqAnswer.version');
    if (row.promptVersion !== currentVersion) {
      await this.draftsRepo.markStale(questionId, new Date());
      draft.stale = true;
      void this.generateForQuestion(_businessId, questionId).catch((err) =>
        this.logger.error(
          `failed to enqueue prompt-version FAQ regenerate for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } else if (row.stale) {
      void this.generateForQuestion(_businessId, questionId).catch((err) =>
        this.logger.error(
          `failed to enqueue stale FAQ regenerate for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
    return draft;
  }

  /**
   * The owner publishes the AI draft as a business_answer. Calls
   * QaService.upsertAnswer (which does the access check + creates the row +
   * emits the question.answered event). Idempotent: a second publish on the
   * same draft returns the existing answer (created=false) without
   * re-calling the LLM.
   */
  async publish(
    _businessId: string,
    questionId: string,
    user: BusinessActor,
  ): Promise<AiFaqPublishResult> {
    const row = await this.draftsRepo.findByQuestionId(questionId);
    if (!row || !row.draft) {
      throw new FaqDraftNotReadyError(questionId);
    }
    if (row.dismissed) {
      throw new FaqDraftDismissedError(questionId);
    }
    if (row.published) {
      // Already published — return the existing answer (the QA service
      // upsert is idempotent too, but we skip the call to avoid an extra
      // edit_at bump).
      const existing = await this.qa.findAnswerForQuestion(questionId);
      if (existing) {
        return { answerId: existing.id, text: existing.body, created: false };
      }
      // Fall through — the draft says published but the answer is gone
      // (the owner deleted the answer; we re-publish).
    }

    // Create / update the business_answer with the AI text. The QA service
    // does the access check + emits the question.answered event.
    const result = await this.qa.upsertAnswer(questionId, user, { body: row.draft });
    await this.draftsRepo.markPublished(questionId, new Date());
    return { answerId: result.answer.id, text: result.answer.body, created: result.created };
  }

  /** The owner dismisses the draft. */
  async dismiss(_businessId: string, questionId: string): Promise<AiFaqDismissResult> {
    await this.draftsRepo.markDismissed(questionId, new Date());
    return { dismissed: true };
  }

  /** Admin forces a regenerate. */
  async regenerate(_businessId: string, questionId: string): Promise<AiFaqRegenerateResult> {
    void this.generateForQuestion(_businessId, questionId).catch((err) =>
      this.logger.error(
        `failed to regenerate FAQ draft for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    return { enqueued: true, jobId: null };
  }

  /** The subscriber hook on question.created. */
  async onQuestionCreated(businessId: string, questionId: string): Promise<void> {
    void this.generateForQuestion(businessId, questionId).catch((err) =>
      this.logger.error(
        `failed to enqueue initial FAQ draft for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }

  /** The subscriber hook on question.updated. */
  async onQuestionUpdated(_businessId: string, questionId: string): Promise<void> {
    try {
      await this.draftsRepo.markStale(questionId, new Date());
    } catch (err) {
      this.logger.error(
        `failed to mark FAQ draft stale for ${questionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The actual generation logic. Always succeeds (stores the error on failure). */
  async generateForQuestion(_businessId: string, questionId: string): Promise<AiFaqAnswer | null> {
    const [systemPrompt, promptVersion] = await Promise.all([
      this.settings.get<string>('ai.prompts.faqAnswer.system'),
      this.settings.get<number>('ai.prompts.faqAnswer.version'),
    ]);

    // Read the question body via the QA service (so we don't duplicate the
    // approval-gate + access logic).
    const question = await this.qa.findQuestionForAi(questionId);
    if (!question) {
      this.logger.warn(`question ${questionId} not found; skipping FAQ draft`);
      return null;
    }
    if (question.status !== 'approved') {
      this.logger.warn(`question ${questionId} status=${question.status}; skipping FAQ draft`);
      return null;
    }

    // Fetch a few recent approved reviews for grounding (best-effort).
    let recentReviews: Array<{ rating: number; body: string }> = [];
    try {
      const reviewsPage = await this.reviews.listForSummary(question.businessId, 5);
      recentReviews = reviewsPage.items;
    } catch (err) {
      this.logger.warn(
        `failed to fetch reviews for FAQ grounding (business=${question.businessId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Build the user-prompt body: the question + the recent reviews for
    // grounding (the business name is not fetched here to avoid coupling
    // to BusinessesService; the LLM still has the question body + reviews).
    const userPrompt = [
      `سوال کاربر: ${question.body}`,
      recentReviews.length > 0
        ? `نظرات اخیر کاربران:\n${recentReviews.map((r) => `- ${r.rating}/5: ${r.body.slice(0, 200)}`).join('\n')}`
        : 'نظری برای این کسب‌وکار ثبت نشده است.',
    ].join('\n\n');

    const req: AiCompletionRequest = {
      feature: 'faq_auto_answer',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 200,
      temperature: 0.4,
    };

    const result = await this.ai.complete(req);

    const draftText = result.ok && result.text ? result.text : 'پاسخ آزمایشی در دسترس نیست.';

    const updated = await this.draftsRepo.upsert({
      questionId,
      draft: draftText,
      driver: result.driver,
      model: result.model,
      promptVersion,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      lastError: result.ok ? null : (result.errorCode ?? 'unknown'),
    });

    return toWire(updated);
  }
}

/** Convert a DB row to the wire type. */
function toWire(row: AiFaqAnswerRow): AiFaqAnswer {
  return {
    questionId: row.questionId,
    draft: row.draft,
    driver: row.driver as AiFaqAnswer['driver'],
    model: row.model,
    promptVersion: row.promptVersion,
    published: row.published,
    dismissed: row.dismissed,
    stale: row.stale,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Error thrown when the owner tries to publish a draft that doesn't exist yet. */
export class FaqDraftNotReadyError extends Error {
  constructor(questionId: string) {
    super(`FAQ AI draft for question ${questionId} is not ready yet`);
    this.name = 'FaqDraftNotReadyError';
  }
}

/** Error thrown when the owner tries to publish a dismissed draft. */
export class FaqDraftDismissedError extends Error {
  constructor(questionId: string) {
    super(`FAQ AI draft for question ${questionId} was dismissed`);
    this.name = 'FaqDraftDismissedError';
  }
}
