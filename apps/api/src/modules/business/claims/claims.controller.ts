import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  createBusinessClaimBodySchema,
  reviewBusinessClaimBodySchema,
  type CreateBusinessClaimBody,
  type ReviewBusinessClaimBody,
} from '@app/contracts';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../../audit/audit.service.js';
import { roleHasPermissions } from '../../users/users.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ClaimsService } from './claims.service.js';
import type { BusinessActor } from '../business-access.js';

/** The req.user shape set by JwtAuthGuard (undefined on @Public routes). */
function userOf(req: Request): BusinessActor | undefined {
  const u = (req as Request & { user?: { id: string; role: string } }).user;
  return u ? { id: u.id, role: u.role } : undefined;
}

/** Non-@Public routes are guaranteed req.user by the global JwtAuthGuard. */
function requireUser(req: Request): BusinessActor {
  const user = userOf(req);
  if (!user) throw new ForbiddenException('Authentication required');
  return user;
}

/** Actor + request info for the audit row (mirrors businesses.controller). */
function auditInfo(req: Request): {
  actor: { id: string | null; role: string | null };
  request: { ip: string | null; userAgent: string | null; requestId: string | null };
} {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  const ua = req.headers['user-agent'];
  const rid = req.headers['x-request-id'];
  return {
    actor: { id: user?.id ?? null, role: user?.role ?? null },
    request: {
      ip: req.ip ?? null,
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      requestId: typeof rid === 'string' ? rid : null,
    },
  };
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

/** Review endpoints are `businesses.manage` only (admin / super_admin). */
function assertAdmin(user: BusinessActor): void {
  if (!roleHasPermissions(user.role as never, ['businesses.manage'])) {
    throw new ForbiddenException({
      code: 'FORBIDDEN' as const,
      messageKey: 'errors.forbidden',
      message: 'businesses.manage permission required',
    });
  }
}

/**
 * Business ownership claim endpoints (B2.9). Filing is for any authenticated
 * user on an UNCLAIMED business (evidence text + optional uploaded document,
 * kind `claim_document`); the business's claim history is `businesses.manage`
 * only; review (approve → ownership lands transactionally / reject → note
 * required) is `businesses.manage`; the claimant may cancel their own pending
 * claim. Every write is audited and rate-limited. Route order matters:
 * `/businesses/claims/me` is declared before any `:id`-shaped route.
 */
@Controller()
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  @Get('businesses/claims/me')
  @RateLimit({ name: 'business.claims.read', limit: 60, windowSec: 60, scope: 'user' })
  async listMine(@Req() req: Request) {
    const user = requireUser(req);
    return { items: await this.claims.listMine(user) };
  }

  @Get('businesses/:id/claims')
  @RateLimit({ name: 'business.claims.read', limit: 60, windowSec: 60, scope: 'user' })
  async listByBusiness(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    assertAdmin(user);
    return { items: await this.claims.listByBusiness(id) };
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  @Post('businesses/:id/claims')
  @RateLimit({
    name: 'business.claims.write',
    limit: 10,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  async create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createBusinessClaimBodySchema)) body: CreateBusinessClaimBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const claim = await this.claims.create(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.claim.create',
      entityType: 'business',
      entityId: id,
      after: { claimId: claim.id, hasDocument: claim.documentUrl !== null },
      request,
    });
    return claim;
  }

  @Post('businesses/claims/:claimId/review')
  @RateLimit({ name: 'business.claims.write', limit: 30, windowSec: 60, scope: 'user' })
  async review(
    @Req() req: Request,
    @Param('claimId') claimId: string,
    @Body(new ZodValidationPipe(reviewBusinessClaimBodySchema)) body: ReviewBusinessClaimBody,
  ) {
    const user = requireUser(req);
    assertUuid(claimId, 'claimId');
    assertAdmin(user);
    const claim = await this.claims.review(claimId, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: `business.claim.${body.decision}`,
      entityType: 'business',
      entityId: claim.businessId,
      before: { status: 'pending' },
      after: { claimId: claim.id, status: claim.status, adminNote: claim.adminNote },
      request,
    });
    return claim;
  }

  @Post('businesses/claims/:claimId/cancel')
  @RateLimit({ name: 'business.claims.write', limit: 30, windowSec: 60, scope: 'user' })
  async cancel(@Req() req: Request, @Param('claimId') claimId: string) {
    const user = requireUser(req);
    assertUuid(claimId, 'claimId');
    const claim = await this.claims.cancel(claimId, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.claim.cancel',
      entityType: 'business',
      entityId: claim.businessId,
      before: { status: 'pending' },
      after: { claimId: claim.id, status: 'cancelled' },
      request,
    });
    return claim;
  }
}
