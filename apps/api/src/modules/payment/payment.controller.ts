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
  createPaymentBodySchema,
  listPaymentsQuerySchema,
  verifyPaymentParamsSchema,
  type CreatePaymentBody,
  type ListPaymentsQuery,
  type Payment,
  type VerifyPaymentParams,
  type VerifyPaymentResult,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PaymentService } from './payment.service.js';

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
 * Payment endpoints (B8.1) — all AUTHENTICATED (the caller's own payments).
 *
 *   POST /payments                         create an idempotent payment intent
 *   GET  /payments/:id                      fetch one payment (owner only)
 *   POST /payments/:id/verify              verify after the gateway callback
 *   GET  /payments                          list the caller's payments
 *
 * Rate-limited (user-scoped 30/min) — the create + verify are the hot paths
 * a checkout retries on. The gateway itself is the slow hop; the API's job is
 * the idempotency gate + the row bookkeeping, both fast.
 */
@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post('payments')
  @RateLimit({ name: 'payments.create', limit: 30, windowSec: 60, scope: 'user' })
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createPaymentBodySchema)) body: CreatePaymentBody,
  ): Promise<Payment> {
    const user = requireUser(req);
    // The businessId is optional on the body (a topup has no business); the
    // caller's identity is the only ownership signal. The F8.1 form passes
    // the businessId via a header so the route stays contract-clean.
    const businessId = (req.headers['x-business-id'] as string | undefined) ?? undefined;
    return this.payments.create(body, { id: user.id, businessId });
  }

  @Get('payments/:id')
  @RateLimit({ name: 'payments.read', limit: 60, windowSec: 60, scope: 'user' })
  async getOne(@Req() req: Request, @Param('id') id: string): Promise<Payment> {
    const user = requireUser(req);
    return this.payments.getOne(assertUuid(id, 'paymentId'), { id: user.id });
  }

  @Post('payments/:id/verify')
  @RateLimit({ name: 'payments.verify', limit: 30, windowSec: 60, scope: 'user' })
  async verify(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(verifyPaymentParamsSchema)) params: VerifyPaymentParams,
  ): Promise<VerifyPaymentResult> {
    const user = requireUser(req);
    return this.payments.verify(assertUuid(id, 'paymentId'), params, { id: user.id });
  }

  @Get('payments')
  @RateLimit({ name: 'payments.list', limit: 60, windowSec: 60, scope: 'user' })
  async list(
    @Req() req: Request,
    @Query(new ZodValidationPipe(listPaymentsQuerySchema)) query: ListPaymentsQuery,
  ): Promise<{ items: Payment[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const user = requireUser(req);
    return this.payments.list(query, { id: user.id });
  }
}
