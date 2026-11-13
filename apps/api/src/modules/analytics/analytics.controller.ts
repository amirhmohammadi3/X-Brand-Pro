import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  ANALYTICS_INGEST_LIMIT_PER_MIN,
  ANALYTICS_STATS_LIMIT_PER_MIN,
  analyticsStatsQuerySchema,
  ingestAnalyticsBodySchema,
  type AnalyticsStatsQuery,
  type AnalyticsStatsResult,
  type IngestAnalyticsBody,
  type IngestAnalyticsResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AnalyticsService } from './analytics.service.js';

/** The req.user shape set by JwtAuthGuard. */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/** Path params must be UUIDs — a garbage id answers 422, never a 500 from the DB. */
function assertUuid(raw: string, what: string): string {
  if (!uuidSchema.safeParse(raw).success) {
    throw new UnprocessableEntityException({
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message: `${what} must be a UUID`,
      details: { [what]: raw },
    });
  }
  return raw;
}

/**
 * Analytics endpoints (B7.1/B7.2):
 * - POST /analytics/events — PUBLIC (the client tracker fires it), ip-scoped
 *   60/min, batched, aggregate-only (no identity in the payload);
 * - GET /analytics/business/:id/stats — the OWNER's dashboard read.
 */
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Public()
  @Post('analytics/events')
  @RateLimit({
    name: 'analytics.ingest',
    limit: ANALYTICS_INGEST_LIMIT_PER_MIN,
    windowSec: 60,
  })
  async ingest(
    @Req() req: Request,
    @Body(new ZodValidationPipe(ingestAnalyticsBodySchema)) body: IngestAnalyticsBody,
  ): Promise<IngestAnalyticsResult> {
    const accepted = await this.analytics.ingest(body, req.ip ?? null);
    return { accepted };
  }

  @Get('analytics/business/:id/stats')
  @RateLimit({
    name: 'analytics.stats',
    limit: ANALYTICS_STATS_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async stats(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(analyticsStatsQuerySchema)) query: AnalyticsStatsQuery,
  ): Promise<AnalyticsStatsResult> {
    const user = requireUser(req);
    return this.analytics.stats(assertUuid(id, 'businessId'), user, query);
  }
}
