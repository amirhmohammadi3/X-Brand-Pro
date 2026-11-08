import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  attachBusinessPhotoBodySchema,
  reorderBusinessPhotosBodySchema,
  setBusinessCoverBodySchema,
  type AttachBusinessPhotoBody,
  type ReorderBusinessPhotosBody,
  type SetBusinessCoverBody,
} from '@app/contracts';
import { Public } from '../../../common/decorators/public.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PhotosService } from './photos.service.js';
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
 * Business photo gallery endpoints (B2.7). The GET is public for active
 * businesses (and visible to the owner / a `businesses.manage` holder for
 * non-active ones, answering 404 otherwise — the same never-leak rule as the
 * hours and detail endpoints, reusing `canViewBusinessHours`). Every write
 * requires `assertCanManageBusiness` (owner of an editable-status business or
 * `businesses.manage`) and writes an audit row. Uploads themselves are B1.9's
 * POST /media/upload (kind `business_photo`); these routes attach/order/delete
 * gallery entries and set the cover.
 */
@Controller()
export class PhotosController {
  constructor(
    private readonly photos: PhotosService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Read ────────────────────────────────────────────────────────────────

  @Public()
  @Get('businesses/:id/photos')
  @RateLimit({ name: 'business.photos.read', limit: 120, windowSec: 60 })
  async list(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.photos.getBusinessContext(id);
    const viewer = userOf(req);
    if (!canViewBusinessHours(viewer, { ownerId: ctx.ownerId, status: ctx.status })) {
      // Non-active business the caller may not see → 404, never 403.
      throw new NotFoundException(`Business ${id} not found`);
    }
    return { items: await this.photos.list(id) };
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  @Post('businesses/:id/photos')
  @RateLimit({ name: 'business.photos.write', limit: 60, windowSec: 60, scope: 'user' })
  async attach(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attachBusinessPhotoBodySchema)) body: AttachBusinessPhotoBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const ctx = await this.photos.getBusinessContext(id);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status });
    const photo = await this.photos.attach(id, user, body.mediaId);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.photo.attach',
      entityType: 'business',
      entityId: id,
      after: { photoId: photo.id, mediaId: photo.mediaId, sortOrder: photo.sortOrder },
      request,
    });
    return photo;
  }

  @Put('businesses/:id/photos/order')
  @RateLimit({ name: 'business.photos.write', limit: 60, windowSec: 60, scope: 'user' })
  async reorder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reorderBusinessPhotosBodySchema)) body: ReorderBusinessPhotosBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const ctx = await this.photos.getBusinessContext(id);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status });
    const items = await this.photos.reorder(id, body.photoIds);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.photo.reorder',
      entityType: 'business',
      entityId: id,
      after: { order: body.photoIds },
      request,
    });
    return { items };
  }

  @Put('businesses/:id/photos/cover')
  @RateLimit({ name: 'business.photos.write', limit: 60, windowSec: 60, scope: 'user' })
  async setCover(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setBusinessCoverBodySchema)) body: SetBusinessCoverBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    const ctx = await this.photos.getBusinessContext(id);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status });
    const items = await this.photos.setCover(id, body.mediaId);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.photo.cover',
      entityType: 'business',
      entityId: id,
      after: { coverMediaId: body.mediaId },
      request,
    });
    return { items };
  }

  @Delete('businesses/:id/photos/:photoId')
  @RateLimit({ name: 'business.photos.write', limit: 60, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string, @Param('photoId') photoId: string) {
    const user = requireUser(req);
    assertUuid(id, 'businessId');
    assertUuid(photoId, 'photoId');
    const ctx = await this.photos.getBusinessContext(id);
    assertCanManageBusiness(user, { ownerId: ctx.ownerId, status: ctx.status });
    await this.photos.remove(id, photoId, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'business.photo.delete',
      entityType: 'business',
      entityId: id,
      before: { photoId },
      request,
    });
    return { ok: true };
  }
}
