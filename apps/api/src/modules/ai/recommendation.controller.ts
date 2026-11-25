import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  aiRecommendationQuerySchema,
  type AiRecommendationQuery,
  type AiRecommendationResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// RecommendationService is constructor-injected: Nest reads its type at
// runtime from emitDecoratorMetadata, so it must stay a value import.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RecommendationService } from './recommendation.service.js';

/** The req.user shape set by JwtAuthGuard (this controller has no @Public routes). */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) {
    throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  }
  return user;
}

/**
 * Recommendation controller (A9.5). One endpoint:
 *  - GET /recommendations — the authenticated user's personalized list.
 *
 * User-scoped (the JWT identifies the user); rate-limited 30/min/user. The
 * ranking is rule-based (always available, even with AI fully off);
 * `?explain=true` opts into ONE LLM explanation for the page's top item
 * (gated by `ai.feature.recommendationsEnabled` through AiService, fail-soft).
 */
@Controller()
export class RecommendationController {
  constructor(private readonly recommendations: RecommendationService) {}

  @Get('recommendations')
  @RateLimit({ name: 'recommendations.read', limit: 30, windowSec: 60, scope: 'user' })
  async list(
    @Req() req: Request,
    @Query(new ZodValidationPipe(aiRecommendationQuerySchema)) query: AiRecommendationQuery,
  ): Promise<AiRecommendationResult> {
    const user = requireUser(req);
    return this.recommendations.getRecommendations(user.id, query);
  }
}
