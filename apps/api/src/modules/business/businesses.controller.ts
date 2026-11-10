import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createBusinessBodySchema,
  updateBusinessBodySchema,
  businessTransitionBodySchema,
  businessPageQuerySchema,
  type BusinessPageQuery,
  type CreateBusinessBody,
  type UpdateBusinessBody,
  type BusinessTransitionBody,
} from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BusinessesService } from './businesses.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BusinessPageService } from './businesses-page.service.js';
import { type BusinessActor } from './business-access.js';

/** The req.user shape set by JwtAuthGuard (undefined on @Public routes). */
function userOf(req: Request): BusinessActor | undefined {
  const u = (req as Request & { user?: { id: string; role: string } }).user;
  return u ? { id: u.id, role: u.role } : undefined;
}

/** Actor + request info for the audit row (mirrors the categories admin controller). */
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

/**
 * Business catalog CRUD endpoints (B2.6). Registration, owner list, detail,
 * update, status transition and soft delete. The detail GET is public for
 * active businesses (and visible to the owner / a `businesses.manage` holder
 * for non-active ones, answering 404 otherwise — existence is never leaked);
 * every write is authenticated, rate-limited per user, and writes an audit row.
 *
 * Route order matters: `/businesses/me` is declared before `/businesses/:idOrSlug`
 * so `me` is not captured as the id-or-slug param.
 */
@Controller()
export class BusinessesController {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly pages: BusinessPageService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────────────

  /** The caller's own businesses (every status). Authenticated. */
  @Get('businesses/me')
  @RateLimit({ name: 'business.read', limit: 120, windowSec: 60, scope: 'user' })
  async listMine(@Req() req: Request) {
    const user = userOf(req);
    if (!user) return { items: [] as never[] };
    return { items: await this.businesses.listMyBusinesses(user) };
  }

  /** Public detail by id (UUID) or slug; non-active → owner/admin only, else 404. */
  @Public()
  @Get('businesses/:idOrSlug')
  @RateLimit({ name: 'business.read', limit: 120, windowSec: 60 })
  async getDetail(@Req() req: Request, @Param('idOrSlug') idOrSlug: string) {
    return this.businesses.getBusinessDetail(userOf(req), idOrSlug);
  }

  /**
   * B4.9 — the ONE aggregate read the F4.1 business page needs for first
   * paint (detail + hours + gallery + menu + first reviews page + question
   * count + schema.org JSON-LD). Same visibility gate as the detail GET
   * above (the actor is always undefined on a @Public route — non-active
   * businesses answer 404 to every guest). The embedded reviews page is
   * capped at 20; the full paginated list remains the reviews endpoint's job.
   */
  @Public()
  @Get('businesses/:idOrSlug/page')
  @RateLimit({ name: 'business.page', limit: 60, windowSec: 60 })
  async getPage(
    @Req() req: Request,
    @Param('idOrSlug') idOrSlug: string,
    @Query(new ZodValidationPipe(businessPageQuerySchema)) query: BusinessPageQuery,
  ) {
    return this.pages.getPage(idOrSlug, userOf(req), query);
  }

  // ─── Create ─────────────────────────────────────────────────────────────

  @Post('businesses')
  @RateLimit({ name: 'business.write', limit: 30, windowSec: 60, scope: 'user' })
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createBusinessBodySchema)) body: CreateBusinessBody,
  ) {
    const user = userOf(req);
    // JwtAuthGuard guarantees req.user on non-@Public routes.
    if (!user) return null as never;
    const { actor, request } = auditInfo(req);
    const business = await this.businesses.createBusiness(user, body);
    this.audit.log({
      actor,
      action: 'business.create',
      entityType: 'business',
      entityId: business.id,
      after: { slug: business.slug, name: business.name, status: business.status },
      request,
    });
    return business;
  }

  // ─── Update ─────────────────────────────────────────────────────────────

  @Patch('businesses/:id')
  @RateLimit({ name: 'business.write', limit: 60, windowSec: 60, scope: 'user' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBusinessBodySchema)) body: UpdateBusinessBody,
  ) {
    const user = userOf(req);
    if (!user) return null as never;
    const { actor, request } = auditInfo(req);
    const business = await this.businesses.updateBusiness(user, id, body);
    this.audit.log({
      actor,
      action: 'business.update',
      entityType: 'business',
      entityId: id,
      after: { slug: business.slug, name: business.name, status: business.status },
      request,
    });
    return business;
  }

  // ─── Status transition ──────────────────────────────────────────────────

  @Post('businesses/:id/transition')
  @RateLimit({ name: 'business.write', limit: 60, windowSec: 60, scope: 'user' })
  async transition(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(businessTransitionBodySchema)) body: BusinessTransitionBody,
  ) {
    const user = userOf(req);
    if (!user) return null as never;
    const { actor, request } = auditInfo(req);
    const { business, previousStatus } = await this.businesses.transitionBusiness(user, id, body);
    this.audit.log({
      actor,
      action: 'business.transition',
      entityType: 'business',
      entityId: id,
      before: { status: previousStatus },
      after: { status: business.status, rejectionReason: body.rejectionReason ?? null },
      request,
    });
    return business;
  }

  // ─── Soft delete ────────────────────────────────────────────────────────

  @Delete('businesses/:id')
  @RateLimit({ name: 'business.write', limit: 30, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = userOf(req);
    if (!user) return null as never;
    const { actor, request } = auditInfo(req);
    await this.businesses.deleteBusiness(user, id);
    this.audit.log({
      actor,
      action: 'business.delete',
      entityType: 'business',
      entityId: id,
      request,
    });
    return { ok: true };
  }
}
