import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import { replaceMenuBodySchema, type ReplaceMenuBody } from '@app/contracts';
import { Public } from '../../../common/decorators/public.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MenuService } from './menu.service.js';
import {
  assertCanManageBusiness,
  canViewBusinessHours,
  type BusinessActor,
} from '../business-access.js';

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

/**
 * Business menu / services endpoints (B2.8). The GET is public for active
 * businesses (and visible to the owner / a `businesses.manage` holder for
 * non-active ones, answering 404 otherwise — the shared never-leak rule,
 * reusing `canViewBusinessHours`). The PUT replaces the WHOLE menu atomically
 * (B2.5-style full replace), requires `assertCanManageBusiness`, is audited
 * (`business.menu.replace`) and rate-limited. Photos ride B1.9's
 * POST /media/upload (kind `menu_photo`) and are referenced by media id.
 */
@Controller()
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('businesses/:id/menu')
  @RateLimit({ name: 'business.menu.read', limit: 120, windowSec: 60 })
  async getMenu(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.menu.getBusinessContext(id);
    const viewer = userOf(req);
    if (!canViewBusinessHours(viewer, { ownerId: ctx.ownerId, status: ctx.status })) {
      // Non-active business the caller may not see → 404, never 403.
      throw new NotFoundException(`Business ${id} not found`);
    }
    return this.menu.getMenu(id);
  }

  @Put('businesses/:id/menu')
  @RateLimit({ name: 'business.menu.write', limit: 30, windowSec: 60, scope: 'user' })
  async replaceMenu(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replaceMenuBodySchema)) body: ReplaceMenuBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const ctx = await this.menu.getBusinessContext(id);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status });
    const result = await this.menu.replaceMenu(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.menu.replace',
      entityType: 'business',
      entityId: id,
      after: {
        sections: body.sections.length,
        items: body.sections.reduce((n, s) => n + s.items.length, 0),
      },
      request,
    });
    return result;
  }
}
