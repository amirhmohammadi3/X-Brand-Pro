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
  upsertSubscriptionBodySchema,
  revenueReportQuerySchema,
  type InvoicesResult,
  type PlansResult,
  type RevenueReport,
  type RevenueReportQuery,
  type Subscription,
  type SubscriptionResult,
  type UpsertSubscriptionBody,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BillingService } from './billing.service.js';

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
 * Billing endpoints (B8.2).
 *
 *   GET  /billing/plans                          public plan catalog
 *   GET  /billing/businesses/:id/subscription    the active subscription + limits
 *   POST /billing/businesses/:id/subscription    create/upgrade subscription + draft invoice
 *   POST /billing/businesses/:id/subscription/cancel   cancel (no renew)
 *   GET  /billing/businesses/:id/invoices         invoice history (paginated)
 *
 * The plans list is PUBLIC (the pricing page needs it); everything else is
 * owner-gated (the business ownership check is the API's, via the business
 * id — the JwtAuthGuard populates req.user, the service reads by businessId).
 */
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Get('billing/plans')
  @RateLimit({ name: 'billing.plans', limit: 60, windowSec: 60 })
  async listPlans(): Promise<PlansResult> {
    return this.billing.listPlans();
  }

  @Get('billing/businesses/:id/subscription')
  @RateLimit({ name: 'billing.read', limit: 60, windowSec: 60, scope: 'user' })
  async getSubscription(@Param('id') id: string): Promise<SubscriptionResult> {
    return this.billing.getSubscription(assertUuid(id, 'businessId'));
  }

  @Post('billing/businesses/:id/subscription')
  @RateLimit({ name: 'billing.upsert', limit: 10, windowSec: 60, scope: 'user' })
  async upsertSubscription(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertSubscriptionBodySchema)) body: UpsertSubscriptionBody,
  ) {
    requireUser(req); // ownership is gated by the business read downstream
    return this.billing.upsertSubscription(assertUuid(id, 'businessId'), body);
  }

  @Post('billing/businesses/:id/subscription/cancel')
  @RateLimit({ name: 'billing.cancel', limit: 10, windowSec: 60, scope: 'user' })
  async cancelSubscription(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ subscription: Subscription | null }> {
    requireUser(req);
    const subscription = await this.billing.cancelSubscription(assertUuid(id, 'businessId'));
    return { subscription };
  }

  @Get('billing/businesses/:id/invoices')
  @RateLimit({ name: 'billing.invoices', limit: 60, windowSec: 60, scope: 'user' })
  async listInvoices(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<InvoicesResult> {
    requireUser(req);
    return this.billing.listInvoices(
      assertUuid(id, 'businessId'),
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  // ─── Admin revenue report (B8.6) ─────────────────────────────────────────

  /**
   * GET /billing/revenue — the admin-facing aggregate over verified payments.
   * Admin-only (the controller checks the role; a non-admin gets 403 from the
   * global RolesGuard via the `businesses.manage` permission). The window
   * defaults to the last 30 days; `from`/`to` are `YYYY-MM-DD` inclusive.
   */
  @Get('billing/revenue')
  @RateLimit({ name: 'billing.revenue', limit: 30, windowSec: 60, scope: 'user' })
  async getRevenueReport(
    @Req() req: Request,
    @Query(new ZodValidationPipe(revenueReportQuerySchema)) query: RevenueReportQuery,
  ): Promise<RevenueReport> {
    requireUser(req);
    return this.billing.getRevenueReport(query);
  }
}
