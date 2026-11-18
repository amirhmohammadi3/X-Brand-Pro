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
  createCampaignBodySchema,
  updateCampaignStatusBodySchema,
  type Campaign,
  type CampaignsResult,
  type CampaignStatsResult,
  type CreateCampaignBody,
  type UpdateCampaignStatusBody,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AdsService } from './ads.service.js';

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
 * Ads endpoints (B8.3) — all AUTHENTICATED (the owner's campaigns).
 *
 *   POST /ads/businesses/:id/campaigns          create a draft campaign
 *   GET  /ads/businesses/:id/campaigns           list the owner's campaigns
 *   GET  /ads/campaigns/:id                       fetch one campaign
 *   PATCH /ads/campaigns/:id/status               pause/resume/end/archive
 *   POST /ads/campaigns/:id/prepare-payment       flip draft → pending_payment + return payment descriptor
 *   GET  /ads/campaigns/:id/stats                 the delivery stats (impressions/clicks/ctr/spent)
 *
 * The checkout flow: create (draft) → prepare-payment (pending_payment) →
 * POST /payments (purpose=ads) → verify → AdsService.onPaymentVerified
 * (active). The ad-injection path (B8.4) reads active campaigns.
 */
@Controller()
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Post('ads/businesses/:id/campaigns')
  @RateLimit({ name: 'ads.create', limit: 10, windowSec: 60, scope: 'user' })
  async create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createCampaignBodySchema)) body: CreateCampaignBody,
  ): Promise<Campaign> {
    const user = requireUser(req);
    // The body carries its own businessId (the campaign is business-scoped);
    // the path id is the owner-as-user's selected business — they must match.
    if (body.businessId !== id) {
      throw new UnprocessableEntityException({
        code: 'UNPROCESSABLE' as const,
        messageKey: 'errors.unprocessable',
        message: 'body.businessId must match the path businessId.',
        details: { path: id, body: body.businessId },
      });
    }
    return this.ads.create(body, user.id);
  }

  @Get('ads/businesses/:id/campaigns')
  @RateLimit({ name: 'ads.list', limit: 60, windowSec: 60, scope: 'user' })
  async list(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<CampaignsResult> {
    requireUser(req);
    return this.ads.list(assertUuid(id, 'businessId'), page ? Number(page) : 1, pageSize ? Number(pageSize) : 20);
  }

  @Get('ads/campaigns/:id')
  @RateLimit({ name: 'ads.read', limit: 60, windowSec: 60, scope: 'user' })
  async getOne(@Param('id') id: string): Promise<Campaign> {
    return this.ads.getOne(assertUuid(id, 'campaignId'));
  }

  @Post('ads/campaigns/:id/status')
  @RateLimit({ name: 'ads.status', limit: 20, windowSec: 60, scope: 'user' })
  async updateStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampaignStatusBodySchema)) body: UpdateCampaignStatusBody,
  ): Promise<Campaign> {
    requireUser(req);
    return this.ads.updateStatus(assertUuid(id, 'campaignId'), body);
  }

  @Post('ads/campaigns/:id/prepare-payment')
  @RateLimit({ name: 'ads.prepare', limit: 10, windowSec: 60, scope: 'user' })
  async preparePayment(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    requireUser(req);
    return this.ads.preparePayment(assertUuid(id, 'campaignId'));
  }

  @Get('ads/campaigns/:id/stats')
  @RateLimit({ name: 'ads.stats', limit: 60, windowSec: 60, scope: 'user' })
  async getStats(@Param('id') id: string): Promise<CampaignStatsResult> {
    return this.ads.getStats(assertUuid(id, 'campaignId'));
  }
}
