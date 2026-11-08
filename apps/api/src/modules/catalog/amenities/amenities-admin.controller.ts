import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createAmenityBodySchema,
  setActiveCityBodySchema,
  setCategoryAmenitiesBodySchema,
  updateAmenityBodySchema,
  type CreateAmenityBody,
  type SetActiveCityBody,
  type SetCategoryAmenitiesBody,
  type UpdateAmenityBody,
} from '@app/contracts';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../../audit/audit.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AmenitiesService } from './amenities.service.js';

/** Admin amenity endpoints (B2.3). `catalog.manage`, audited, 60/min per user. */
@Controller()
export class AmenitiesAdminController {
  constructor(
    private readonly amen: AmenitiesService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private info(req: Request) {
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

  @Get('admin/amenities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.read', limit: 60, windowSec: 60, scope: 'user' })
  async list() {
    return { items: await this.amen.listAdminAmenities() };
  }

  @Post('admin/amenities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createAmenityBodySchema)) body: CreateAmenityBody,
  ) {
    const { actor, request } = this.info(req);
    const amenity = await this.amen.createAmenity(body, actor);
    this.audit.log({
      actor,
      action: 'catalog.amenity.create',
      entityType: 'amenity',
      entityId: amenity.id,
      request,
    });
    return amenity;
  }

  @Patch('admin/amenities/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAmenityBodySchema)) body: UpdateAmenityBody,
  ) {
    const { actor, request } = this.info(req);
    const amenity = await this.amen.updateAmenity(id, body, actor);
    this.audit.log({
      actor,
      action: 'catalog.amenity.update',
      entityType: 'amenity',
      entityId: id,
      request,
    });
    return amenity;
  }

  @Put('admin/amenities/:id/active')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async setActive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setActiveCityBodySchema)) body: SetActiveCityBody,
  ) {
    const { actor, request } = this.info(req);
    const amenity = await this.amen.setAmenityActive(id, body.isActive, actor);
    this.audit.log({
      actor,
      action: 'catalog.amenity.set_active',
      entityType: 'amenity',
      entityId: id,
      after: { isActive: body.isActive },
      request,
    });
    return amenity;
  }

  @Delete('admin/amenities/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { actor, request } = this.info(req);
    await this.amen.deleteAmenity(id, actor);
    this.audit.log({
      actor,
      action: 'catalog.amenity.delete',
      entityType: 'amenity',
      entityId: id,
      request,
    });
    return { ok: true };
  }

  @Get('admin/categories/:id/amenities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.read', limit: 60, windowSec: 60, scope: 'user' })
  async categoryAmenities(@Param('id') id: string) {
    return { amenityIds: await this.amen.getCategoryAmenities(id) };
  }

  @Put('admin/categories/:id/amenities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async replaceCategoryAmenities(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setCategoryAmenitiesBodySchema)) body: SetCategoryAmenitiesBody,
  ) {
    const { actor, request } = this.info(req);
    const items = await this.amen.replaceCategoryAmenities(id, body, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.amenities.replace',
      entityType: 'category',
      entityId: id,
      after: { count: body.amenityIds.length },
      request,
    });
    return { items };
  }
}
