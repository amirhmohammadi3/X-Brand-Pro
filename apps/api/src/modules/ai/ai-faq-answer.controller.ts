import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type {
  AiFaqAnswer,
  AiFaqDismissResult,
  AiFaqPublishResult,
  AiFaqRegenerateResult,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import type { BusinessActor } from '../business/business-access.js';
import type { Request } from 'express';
// FaqAnswerService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FaqAnswerService } from './faq-answer.service.js';

/**
 * AI FAQ-answer endpoints (A9.4):
 *  - GET /businesses/:id/questions/:qid/ai-draft — owner + admin reads the
 *   current draft (or null on the very first read while the job runs).
 *  - POST /businesses/:id/questions/:qid/ai-draft/publish — owner
 *   publishes the AI draft as the question's business_answer (with the AI
 *   label).
 *  - POST /businesses/:id/questions/:qid/ai-draft/dismiss — owner hides
 *   the draft from the review queue.
 *  - POST /admin/businesses/:id/questions/:qid/ai-draft/regenerate —
 *   admin forces a regenerate (bypasses the debounce).
 *
 * The owner endpoints require `businesses.manage` (the QA service's
 * existing assertAnswerAccess enforces this on the publish path). The
 * admin regenerate uses `settings.manage` (the same permission that gates
 * the rest of the admin AI panel).
 */
@Controller()
export class AiFaqAnswerController {
  constructor(private readonly faqService: FaqAnswerService) {}

  /** GET /businesses/:id/questions/:qid/ai-draft — owner + admin. */
  @Get('businesses/:id/questions/:qid/ai-draft')
  @RequirePermissions('businesses.manage')
  @RateLimit({ name: 'ai.faq.draft.read', limit: 60, windowSec: 60, scope: 'user' })
  async getDraft(@Param('qid') questionId: string): Promise<{ draft: AiFaqAnswer | null }> {
    const draft = await this.faqService.getDraft('', questionId);
    return { draft };
  }

  /** POST /businesses/:id/questions/:qid/ai-draft/publish — owner. */
  @Post('businesses/:id/questions/:qid/ai-draft/publish')
  @RequirePermissions('businesses.manage')
  @RateLimit({ name: 'ai.faq.publish', limit: 10, windowSec: 60, scope: 'user', failClosed: true })
  async publish(
    @Param('id') businessId: string,
    @Param('qid') questionId: string,
    @Req() req: Request,
  ): Promise<AiFaqPublishResult> {
    const user = requireUser(req);
    return this.faqService.publish(businessId, questionId, user);
  }

  /** POST /businesses/:id/questions/:qid/ai-draft/dismiss — owner. */
  @Post('businesses/:id/questions/:qid/ai-draft/dismiss')
  @RequirePermissions('businesses.manage')
  @RateLimit({ name: 'ai.faq.dismiss', limit: 10, windowSec: 60, scope: 'user', failClosed: true })
  async dismiss(
    @Param('id') businessId: string,
    @Param('qid') questionId: string,
  ): Promise<AiFaqDismissResult> {
    return this.faqService.dismiss(businessId, questionId);
  }

  /** POST /admin/businesses/:id/questions/:qid/ai-draft/regenerate — admin. */
  @Post('admin/businesses/:id/questions/:qid/ai-draft/regenerate')
  @RequirePermissions('settings.manage')
  @RateLimit({
    name: 'admin.ai.faq.regenerate',
    limit: 5,
    windowSec: 60,
    scope: 'user',
    failClosed: true,
  })
  async regenerate(
    @Param('id') businessId: string,
    @Param('qid') questionId: string,
  ): Promise<AiFaqRegenerateResult> {
    return this.faqService.regenerate(businessId, questionId);
  }
}

/** Extract the BusinessActor from the request (the same helper the QA controller uses). */
function requireUser(req: Request): BusinessActor {
  const user = (req as unknown as { user?: BusinessActor }).user;
  if (!user) {
    throw new Error('AI FAQ publish endpoint requires an authenticated user');
  }
  return user;
}
