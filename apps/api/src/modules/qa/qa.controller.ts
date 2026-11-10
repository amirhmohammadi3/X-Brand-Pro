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
  createQaQuestionBodySchema,
  qaListQuerySchema,
  updateQaQuestionBodySchema,
  upsertQaAnswerBodySchema,
  type CreateQaQuestionBody,
  type QaListQuery,
  type UpdateQaQuestionBody,
  type UpsertQaAnswerBody,
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
import { QA_MANAGE_PERMISSION, QaService } from './qa.service.js';
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

/** Actor + request info for the audit row (mirrors reviews.controller). */
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
function assertQaManage(user: BusinessActor): void {
  if (!roleHasPermissions(user.role as never, [QA_MANAGE_PERMISSION])) {
    throw new ForbiddenException({
      code: 'FORBIDDEN' as const,
      messageKey: 'errors.forbidden',
      message: 'reviews.manage permission required',
    });
  }
}

/**
 * Q&A endpoints (B4.8). The business list is public (approved questions
 * with their answer joined inline, unless the caller holds `reviews.manage`
 * and asks for a status); create/edit/delete are authenticated with the
 * asker/owner/moderator rules in the service; every write is audited and
 * rate-limited.
 */
@Controller()
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly tokens: TokenService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /**
   * Optional actor on a @Public route: the global JwtAuthGuard skips public
   * routes (req.user is never set here), so the bearer/cookie access token is
   * verified locally (JWT only — no session/status round trips), the same
   * scheme ReviewsController uses for the moderation status filter.
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
  @Get('businesses/:id/questions')
  @RateLimit({ name: 'qa.read', limit: 60, windowSec: 60 })
  async listByBusiness(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(qaListQuerySchema)) query: QaListQuery,
  ) {
    assertUuid(id, 'businessId');
    // The status filter is the moderation view — reviews.manage only. The
    // caller is resolved from the bearer (this route is public; the guard
    // never populated req.user).
    if (query.status) {
      const actor = await this.optionalActor(req);
      if (!actor) throw unauthenticated('Authentication required for the status filter');
      assertQaManage(actor);
    }
    return this.qa.listByBusiness(id, query);
  }

  @Get('questions/me')
  @RateLimit({ name: 'qa.read', limit: 60, windowSec: 60, scope: 'user' })
  async listMine(
    @Req() req: Request,
    @Query(new ZodValidationPipe(qaListQuerySchema)) query: QaListQuery,
  ) {
    const user = requireUser(req);
    return this.qa.listMine(user.id, query);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Ask a question. The strictest rate limit in the module (10/hour,
   * fail-closed) — questions are public-facing content creation, the same
   * abuse class as review creation (reviews.write is 5/hour fail-closed).
   */
  @Post('businesses/:id/questions')
  @RateLimit({
    name: 'qa.ask',
    limit: 10,
    windowSec: 3600,
    scope: 'user',
    failClosed: true,
  })
  async create(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createQaQuestionBodySchema)) body: CreateQaQuestionBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const question = await this.qa.create(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'question.create',
      entityType: 'business',
      entityId: id,
      after: { questionId: question.id },
      request,
    });
    return question;
  }

  @Patch('questions/:id')
  @RateLimit({ name: 'qa.write', limit: 30, windowSec: 60, scope: 'user' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateQaQuestionBodySchema)) body: UpdateQaQuestionBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'questionId');
    const question = await this.qa.update(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'question.update',
      entityType: 'question',
      entityId: id,
      after: { edited: true },
      request,
    });
    return question;
  }

  @Delete('questions/:id')
  @RateLimit({ name: 'qa.write', limit: 30, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'questionId');
    const result = await this.qa.remove(id, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'question.delete',
      entityType: 'question',
      entityId: id,
      after: { deleted: result.deleted },
      request,
    });
    return result;
  }

  // ── Answers (B4.8) ───────────────────────────────────────────────────────

  /**
   * Create or edit the ONE business answer (upsert semantics: a second PUT
   * is an edit of the same row — `created` tells the two apart). The
   * owner/manage authorization and the approved-only rule live in the
   * service; every call is audited (answers are business speech, not
   * high-volume one-row votes).
   */
  @Put('questions/:id/answer')
  @RateLimit({ name: 'qa.answer', limit: 30, windowSec: 60, scope: 'user' })
  async upsertAnswer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(upsertQaAnswerBodySchema)) body: UpsertQaAnswerBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'questionId');
    const result = await this.qa.upsertAnswer(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'question.answer.upsert',
      entityType: 'question',
      entityId: id,
      after: { answerId: result.answer.id, created: result.created },
      request,
    });
    return result;
  }

  /**
   * Remove the answer (owner, answer author or `reviews.manage` takedown).
   * Idempotent when no answer exists — `{ deleted: false }`, no error.
   */
  @Delete('questions/:id/answer')
  @RateLimit({ name: 'qa.answer', limit: 30, windowSec: 60, scope: 'user' })
  async removeAnswer(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'questionId');
    const result = await this.qa.removeAnswer(id, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'question.answer.delete',
      entityType: 'question',
      entityId: id,
      after: { deleted: result.deleted },
      request,
    });
    return result;
  }
}
