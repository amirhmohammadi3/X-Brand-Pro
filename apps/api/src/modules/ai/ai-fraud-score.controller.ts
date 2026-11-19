import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import type {
  AiFraudScore,
  AiFraudScoreQueueQuery,
  AiFraudScoreQueueResult,
  AiFraudScoreRegenerateResult,
} from '@app/contracts';
import { aiFraudScoreQueueQuerySchema } from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// FraudScoreService is constructor-injected (Nest reads its type via emitDecoratorMetadata).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FraudScoreService } from './fraud-score.service.js';

/**
 * AI fraud/toxicity score endpoints (A9.6). All admin-only (moderator +
 * admin). The score is NEVER publicly exposed — a public read would let
 * an attacker probe which reviews the AI flags.
 *
 *  - GET /admin/reviews/:id/fraud-score — moderator reads the score.
 *  - GET /admin/reviews/fraud-scores — the moderation queue (sorted DESC).
 *  - POST /admin/reviews/:id/fraud-score/regenerate — admin forces a
 *   regenerate (bypasses the debounce).
 */
@Controller('admin')
export class AiFraudScoreController {
  constructor(private readonly fraudService: FraudScoreService) {}

  /** GET /admin/reviews/:id/fraud-score — moderator. */
  @Get('reviews/:id/fraud-score')
  @RequirePermissions('reviews.manage')
  @RateLimit({ name: 'admin.ai.fraud.read', limit: 60, windowSec: 60, scope: 'user' })
  async getScore(@Param('id') reviewId: string): Promise<{ score: AiFraudScore | null }> {
    const score = await this.fraudService.getScore(reviewId);
    return { score };
  }

  /** GET /admin/reviews/fraud-scores — the moderation queue. */
  @Get('reviews/fraud-scores')
  @RequirePermissions('reviews.manage')
  @RateLimit({ name: 'admin.ai.fraud.queue', limit: 60, windowSec: 60, scope: 'user' })
  async listQueue(
    @Query(new ZodValidationPipe(aiFraudScoreQueueQuerySchema)) query: AiFraudScoreQueueQuery,
  ): Promise<AiFraudScoreQueueResult> {
    return this.fraudService.listQueue(query);
  }

  /** POST /admin/reviews/:id/fraud-score/regenerate — admin. */
  @Post('reviews/:id/fraud-score/regenerate')
  @RequirePermissions('reviews.manage')
  @RateLimit({
    name: 'admin.ai.fraud.regenerate',
    limit: 5,
    windowSec: 60,
    scope: 'user',
    failClosed: true,
  })
  async regenerate(@Param('id') reviewId: string): Promise<AiFraudScoreRegenerateResult> {
    return this.fraudService.regenerate(reviewId);
  }
}
