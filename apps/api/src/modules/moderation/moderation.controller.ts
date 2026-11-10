import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createReportBodySchema,
  moderateReviewStatusBodySchema,
  reportQueueQuerySchema,
  resolveReportBodySchema,
  reviewQueueQuerySchema,
  uuidSchema,
  type CreateReportBody,
  type ModerateReviewStatusBody,
  type ReportQueueQuery,
  type ResolveReportBody,
  type ReviewQueueQuery,
  MODERATION_REPORT_LIMIT_PER_HOUR,
  MODERATION_READ_LIMIT_PER_MIN,
  MODERATION_DECIDE_LIMIT_PER_MIN,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads ReviewsService's type at runtime via
// emitDecoratorMetadata (constructor DI) — type-only would break injection.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { REVIEWS_MANAGE_PERMISSION, ReviewsService } from '../reviews/reviews.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ModerationService } from './moderation.service.js';
import type { BusinessActor } from '../business/business-access.js';

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

/** Actor + request info for the audit row (mirrors the reviews controller). */
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

/**
 * Moderation endpoints (B4.4). Reports are created by ANY authenticated
 * user (POST /reports); the queues and the decisions are `reviews.manage`
 * (moderator/admin) via the global RolesGuard. Every decision is audited
 * and rate-limited. The review status flip delegates to ReviewsService so
 * the aggregate recompute path stays in ONE place.
 */
@Controller()
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly reviews: ReviewsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Report creation (any authenticated user) ────────────────────────────

  @Post('reports')
  @RateLimit({
    name: 'moderation.report',
    limit: MODERATION_REPORT_LIMIT_PER_HOUR,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  async createReport(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createReportBodySchema)) body: CreateReportBody,
  ) {
    const user = requireUser(req);
    // targetId's UUID-ness is already enforced by createReportBodySchema (400);
    // EXISTENCE is the service's 404 — no separate path-uuid check needed here.
    const result = await this.moderation.createReport(user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'report.create',
      entityType: body.targetType,
      entityId: body.targetId,
      after: { reportId: result.report.id, category: body.category },
      request,
    });
    return result;
  }

  // ─── The moderation queues (reviews.manage) ─────────────────────────────

  @Get('moderation/reports')
  @RequirePermissions(REVIEWS_MANAGE_PERMISSION)
  @RateLimit({
    name: 'moderation.read',
    limit: MODERATION_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listReports(@Query(new ZodValidationPipe(reportQueueQuerySchema)) query: ReportQueueQuery) {
    return this.moderation.listReports(query);
  }

  @Patch('moderation/reports/:id')
  @RequirePermissions(REVIEWS_MANAGE_PERMISSION)
  @RateLimit({
    name: 'moderation.decide',
    limit: MODERATION_DECIDE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async resolveReport(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveReportBodySchema)) body: ResolveReportBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'reportId');
    const result = await this.moderation.resolveReport(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'moderation.report.resolve',
      entityType: 'report',
      entityId: id,
      after: { status: body.status, note: body.resolutionNote ?? null },
      request,
    });
    return result;
  }

  @Get('moderation/reviews')
  @RequirePermissions(REVIEWS_MANAGE_PERMISSION)
  @RateLimit({
    name: 'moderation.read',
    limit: MODERATION_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listReviews(@Query(new ZodValidationPipe(reviewQueueQuerySchema)) query: ReviewQueueQuery) {
    // No ?status= means the PENDING triage queue (oldest first).
    return this.reviews.listForModeration(query.status ?? 'pending', query.page, query.pageSize);
  }

  @Patch('moderation/reviews/:id/status')
  @RequirePermissions(REVIEWS_MANAGE_PERMISSION)
  @RateLimit({
    name: 'moderation.decide',
    limit: MODERATION_DECIDE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async moderateReviewStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moderateReviewStatusBodySchema)) body: ModerateReviewStatusBody,
  ) {
    // No per-user argument: the DECISION is what's audited (auditInfo below);
    // the global JwtAuthGuard has already guaranteed the caller.
    assertUuid(id, 'reviewId');
    const result = await this.reviews.moderateStatus(id, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'moderation.review.status',
      entityType: 'review',
      entityId: id,
      after: { status: body.status, note: body.note ?? null },
      request,
    });
    return result;
  }
}
