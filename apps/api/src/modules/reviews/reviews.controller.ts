import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  createReviewBodySchema,
  reviewListQuerySchema,
  reviewVoteBodySchema,
  updateReviewBodySchema,
  type CreateReviewBody,
  type ReviewListQuery,
  type ReviewVoteBody,
  type UpdateReviewBody,
} from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
import { roleHasPermissions } from '../users/users.service.js';
// Value import: Nest reads the constructor parameter type at runtime via
// emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TokenService } from '../auth/token.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService, REVIEWS_MANAGE_PERMISSION } from './reviews.service.js';
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

function unauthenticated(message: string): HttpException {
  return new HttpException({ code: 'UNAUTHENTICATED' as const, message }, HttpStatus.UNAUTHORIZED);
}

/** Actor + request info for the audit row (mirrors claims.controller). */
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

/** The ?status= filter on the public list is a moderation view. */
function assertReviewsManage(user: BusinessActor): void {
  if (!roleHasPermissions(user.role as never, [REVIEWS_MANAGE_PERMISSION])) {
    throw new ForbiddenException({
      code: 'FORBIDDEN' as const,
      messageKey: 'errors.forbidden',
      message: 'reviews.manage permission required',
    });
  }
}

/**
 * Review endpoints (B4.1). The business list is public (approved reviews
 * only, unless the caller holds `reviews.manage` and asks for a status);
 * create/edit/delete are authenticated with the author/moderator rules in
 * the service; every write is audited and rate-limited. Reviews ride the
 * aggregate recompute asynchronously (reviews-rating.subscriber.ts).
 */
@Controller()
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly tokens: TokenService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Optional actor on a @Public route: the global JwtAuthGuard skips public
   * routes (req.user is never set here), so the bearer/cookie access token is
   * verified locally (JWT only — no session/status round trips), the same
   * scheme SearchController uses for best-effort stats recording.
   */
  private async optionalActor(req: Request): Promise<BusinessActor | null> {
    const header = req.headers.authorization;
    const bearer =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length).trim()
        : undefined;
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = bearer || cookies?.at;
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    return claims ? { id: claims.sub, role: claims.role } : null;
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  @Public()
  @Get('businesses/:id/reviews')
  @RateLimit({ name: 'reviews.read', limit: 60, windowSec: 60 })
  async listByBusiness(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery,
  ) {
    assertUuid(id, 'businessId');
    // The status filter is the moderation view — reviews.manage only. The
    // caller is resolved from the bearer (this route is public; the guard
    // never populated req.user).
    if (query.status) {
      const actor = await this.optionalActor(req);
      if (!actor) throw unauthenticated('Authentication required for the status filter');
      assertReviewsManage(actor);
    }
    return this.reviews.listByBusiness(id, query);
  }

  @Get('reviews/me')
  @RateLimit({ name: 'reviews.read', limit: 60, windowSec: 60, scope: 'user' })
  async listMine(
    @Req() req: Request,
    @Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery,
  ) {
    const user = requireUser(req);
    return this.reviews.listMine(user.id, query);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  @Post('businesses/:id/reviews')
  @RateLimit({
    name: 'reviews.write',
    limit: 5,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  async create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createReviewBodySchema)) body: CreateReviewBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const review = await this.reviews.create(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'review.create',
      entityType: 'business',
      entityId: id,
      after: { reviewId: review.id, rating: review.rating, hasPhoto: review.photoUrl !== null },
      request,
    });
    return review;
  }

  @Patch('reviews/:id')
  @RateLimit({ name: 'reviews.write', limit: 30, windowSec: 60, scope: 'user' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReviewBodySchema)) body: UpdateReviewBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'reviewId');
    const review = await this.reviews.update(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'review.update',
      entityType: 'review',
      entityId: id,
      after: { rating: review.rating, edited: true },
      request,
    });
    return review;
  }

  @Delete('reviews/:id')
  @RateLimit({ name: 'reviews.write', limit: 30, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'reviewId');
    const result = await this.reviews.remove(id, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'review.delete',
      entityType: 'review',
      entityId: id,
      request,
    });
    return result;
  }

  // ─── Votes (B4.2) ────────────────────────────────────────────────────────

  /**
   * Cast/switch the caller's helpful (1) or unhelpful (-1) vote. Auditing is
   * deliberately skipped (unlike the review writes): votes are high-volume
   * one-row upserts of no content — the audit log would flood; the
   * `review.voted`/`review.vote.removed` events (B4.5 spam filter) plus the
   * rate limit carry the abuse signal instead.
   */
  @Put('reviews/:id/vote')
  @RateLimit({ name: 'reviews.vote', limit: 30, windowSec: 60, scope: 'user' })
  async vote(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewVoteBodySchema)) body: ReviewVoteBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'reviewId');
    return this.reviews.vote(id, user, body.value);
  }

  /** Withdraw the caller's vote (idempotent — unknown vote still 200). */
  @Delete('reviews/:id/vote')
  @RateLimit({ name: 'reviews.vote', limit: 30, windowSec: 60, scope: 'user' })
  async removeVote(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'reviewId');
    return this.reviews.removeVote(id, user);
  }
}
