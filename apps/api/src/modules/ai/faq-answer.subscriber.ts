import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
// FaqAnswerService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FaqAnswerService } from './faq-answer.service.js';

/**
 * QA events subscriber (A9.4) — generates an AI draft answer when a new
 * question is created, and marks the existing draft as stale when the
 * question is edited (so the next read regenerates).
 *
 * Best-effort: a subscriber failure must NEVER break the source write
 * (the question CRUD flows run for real; this handler catches everything
 * + logs).
 *
 * Listened events:
 *  - question.created — generate an initial draft (fire-and-forget).
 *  - question.updated — mark the existing draft stale (the next read
 *    regenerates with the new question body).
 *
 * NOT listened (no impact on the draft):
 *  - question.deleted — the FK cascades the draft row away.
 *  - question.answered / answerUpdated / answerDeleted — the owner's
 *    manual answer is independent of the AI draft (the draft is the
 *    suggestion, the answer is the publication).
 */
@Injectable()
export class FaqAnswerSubscriber {
  private readonly logger = new Logger(FaqAnswerSubscriber.name);

  constructor(private readonly faqService: FaqAnswerService) {}

  @OnEvent('question.created')
  onQuestionCreated(payload: { businessId: string; questionId: string }): void {
    this.bestEffort(
      () => this.faqService.onQuestionCreated(payload.businessId, payload.questionId),
      'question.created',
      payload.questionId,
    );
  }

  @OnEvent('question.updated')
  onQuestionUpdated(payload: { businessId: string; questionId: string }): void {
    this.bestEffort(
      () => this.faqService.onQuestionUpdated(payload.businessId, payload.questionId),
      'question.updated',
      payload.questionId,
    );
  }

  private bestEffort(fn: () => Promise<void>, event: string, questionId: string): void {
    void fn().catch((err) => {
      this.logger.error(
        `FAQ subscriber failed (event=${event} questionId=${questionId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }
}
