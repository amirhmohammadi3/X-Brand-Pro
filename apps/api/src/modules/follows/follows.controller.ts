import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  FOLLOW_READ_LIMIT_PER_MIN,
  FOLLOW_WRITE_LIMIT_PER_MIN,
  feedQuerySchema,
  type FeedQuery,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FollowsService } from './follows.service.js';

/** The req.user shape set by JwtAuthGuard (this module has no @Public routes). */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/** Actor + request info for the audit row (mirrors qa/favorites controllers). */
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
 * Follows + feed endpoints (B5.2). Every route is authenticated (the global
 * JwtAuthGuard — no @Public): follows and the home feed are private
 * per-user reads. Writes 30/min per user, reads 60/min per user (contracts
 * constants); follow writes are audited.
 *
 * Route layout:
 * - POST   /follows/businesses/:id  — follow (409 double, 404/422 target gates)
 * - DELETE /follows/businesses/:id  — unfollow (idempotent)
 * - POST   /follows/users/:id       — follow (self-follow 422, blocked 404)
 * - DELETE /follows/users/:id       — unfollow (idempotent)
 * - GET    /follows/me              — both follow lists (cards joined)
 * - GET    /feed                    — the home feed (followed users + businesses)
 */
@Controller()
export class FollowsController {
  constructor(
    private readonly follows: FollowsService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── reads ───────────────────────────────────────────────────────────────

  @Get('follows/me')
  @RateLimit({
    name: 'follows.read',
    limit: FOLLOW_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listMine(@Req() req: Request) {
    const user = requireUser(req);
    return this.follows.listMine(user.id);
  }

  @Get('feed')
  @RateLimit({
    name: 'follows.read',
    limit: FOLLOW_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async feed(@Req() req: Request, @Query(new ZodValidationPipe(feedQuerySchema)) query: FeedQuery) {
    const user = requireUser(req);
    return this.follows.feed(user.id, query);
  }

  // ─── writes ──────────────────────────────────────────────────────────────

  @Post('follows/businesses/:id')
  @RateLimit({
    name: 'follows.write',
    limit: FOLLOW_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async followBusiness(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const result = await this.follows.followBusiness(user.id, id);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'follow.create',
      entityType: 'business',
      entityId: id,
      after: { following: result.following },
      request,
    });
    return result;
  }

  @Delete('follows/businesses/:id')
  @RateLimit({
    name: 'follows.write',
    limit: FOLLOW_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async unfollowBusiness(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const result = await this.follows.unfollowBusiness(user.id, id);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'follow.remove',
      entityType: 'business',
      entityId: id,
      after: { following: result.following },
      request,
    });
    return result;
  }

  @Post('follows/users/:id')
  @RateLimit({
    name: 'follows.write',
    limit: FOLLOW_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async followUser(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'userId');
    const result = await this.follows.followUser(user.id, id);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'follow.create',
      entityType: 'user',
      entityId: id,
      after: { following: result.following },
      request,
    });
    return result;
  }

  @Delete('follows/users/:id')
  @RateLimit({
    name: 'follows.write',
    limit: FOLLOW_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async unfollowUser(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'userId');
    const result = await this.follows.unfollowUser(user.id, id);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'follow.remove',
      entityType: 'user',
      entityId: id,
      after: { following: result.following },
      request,
    });
    return result;
  }
}
