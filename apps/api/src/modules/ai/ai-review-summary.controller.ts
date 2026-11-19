import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type {
  AiReviewSummary,
  AiReviewSummaryQuery,
  AiReviewSummaryRegenerateResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { aiReviewSummaryQuerySchema } from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// ReviewSummaryService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewSummaryService } from './review-summary.service.js';

/**
 * AI review-summary endpoints (A9.3):
 *  - GET /businesses/:id/ai-summary — PUBLIC (cached 60s). Returns the
 *   summary text (or null on the very first read while the job runs).
 *  - POST /admin/businesses/:id/ai-summary/regenerate — owner + admin
 *   only (bypasses the debounce; enqueues an immediate regenerate).
 *
 * The public read is rate-limited (60/min/IP) so a hammering client can't
 * trigger duplicate enqueues. The regenerate endpoint is rate-limited
 * (5/min/user) so an admin can't blow through the token budget.
 */
@Controller()
export class AiReviewSummaryController {
  constructor(private readonly summaryService: ReviewSummaryService) {}

  /** GET /businesses/:id/ai-summary — public. */
  @Get('businesses/:id/ai-summary')
  @RateLimit({ name: 'ai.summary.read', limit: 60, windowSec: 60, scope: 'ip' })
  async getSummary(
    @Param('id') businessId: string,
    @Query(new ZodValidationPipe(aiReviewSummaryQuerySchema)) _query: AiReviewSummaryQuery,
  ): Promise<{ summary: AiReviewSummary | null }> {
    const summary = await this.summaryService.getSummary(businessId);
    return { summary };
  }

  /** POST /admin/businesses/:id/ai-summary/regenerate — owner + admin. */
  @Post('admin/businesses/:id/ai-summary/regenerate')
  @RequirePermissions('businesses.manage')
  @RateLimit({
    name: 'admin.ai.summary.regenerate',
    limit: 5,
    windowSec: 60,
    scope: 'user',
    failClosed: true,
  })
  async regenerate(@Param('id') businessId: string): Promise<AiReviewSummaryRegenerateResult> {
    return this.summaryService.regenerate(businessId);
  }
}
