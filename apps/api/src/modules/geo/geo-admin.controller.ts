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
  createCityBodySchema,
  createNeighborhoodBodySchema,
  reorderCitiesBodySchema,
  reorderNeighborhoodsBodySchema,
  setActiveCityBodySchema,
  updateCityBodySchema,
  updateNeighborhoodBodySchema,
  type CreateCityBody,
  type CreateNeighborhoodBody,
  type ReorderCitiesBody,
  type ReorderNeighborhoodsBody,
  type SetActiveCityBody,
  type UpdateCityBody,
  type UpdateNeighborhoodBody,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GeoService } from './geo.service.js';

/**
 * Admin geo endpoints (B2.1). Every route requires `catalog.manage`, is
 * rate-limited to 60/min per user, and writes an audit row. Cities and
 * neighborhoods CRUD; the delete refuses with 422 `businessCount` when a city
 * still has businesses (deactivate instead).
 */
@Controller()
export class GeoAdminController {
  constructor(
    private readonly geo: GeoService,
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

  // ─── cities ────────────────────────────────────────────────────────────

  @Get('admin/cities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.read', limit: 60, windowSec: 60, scope: 'user' })
  async listCities() {
    return { items: await this.geo.listAdminCities() };
  }

  @Post('admin/cities')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async createCity(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createCityBodySchema)) body: CreateCityBody,
  ) {
    const { actor, request } = this.info(req);
    const city = await this.geo.createCity(body, actor);
    this.audit.log({
      actor,
      action: 'geo.city.create',
      entityType: 'city',
      entityId: city.id,
      request,
    });
    return city;
  }

  @Patch('admin/cities/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async updateCity(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCityBodySchema)) body: UpdateCityBody,
  ) {
    const { actor, request } = this.info(req);
    const city = await this.geo.updateCity(id, body, actor);
    this.audit.log({ actor, action: 'geo.city.update', entityType: 'city', entityId: id, request });
    return city;
  }

  @Delete('admin/cities/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async deleteCity(@Req() req: Request, @Param('id') id: string) {
    const { actor, request } = this.info(req);
    await this.geo.deleteCity(id, actor);
    this.audit.log({ actor, action: 'geo.city.delete', entityType: 'city', entityId: id, request });
    return { ok: true };
  }

  @Put('admin/cities/:id/active')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async setCityActive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setActiveCityBodySchema)) body: SetActiveCityBody,
  ) {
    const { actor, request } = this.info(req);
    const city = await this.geo.setCityActive(id, body.isActive, actor);
    this.audit.log({
      actor,
      action: 'geo.city.set_active',
      entityType: 'city',
      entityId: id,
      after: { isActive: body.isActive },
      request,
    });
    return city;
  }

  @Put('admin/cities/reorder')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async reorderCities(
    @Req() req: Request,
    @Body(new ZodValidationPipe(reorderCitiesBodySchema)) body: ReorderCitiesBody,
  ) {
    const { actor, request } = this.info(req);
    await this.geo.reorderCities(body, actor);
    this.audit.log({
      actor,
      action: 'geo.city.reorder',
      entityType: 'city',
      entityId: null,
      request,
    });
    return { ok: true };
  }

  // ─── neighborhoods (nested under a city) ───────────────────────────────

  @Get('admin/cities/:cityId/neighborhoods')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.read', limit: 60, windowSec: 60, scope: 'user' })
  async listNeighborhoods(@Param('cityId') cityId: string) {
    return { items: await this.geo.listAdminNeighborhoods(cityId) };
  }

  @Post('admin/cities/:cityId/neighborhoods')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async createNeighborhood(
    @Req() req: Request,
    @Param('cityId') cityId: string,
    @Body(new ZodValidationPipe(createNeighborhoodBodySchema)) body: CreateNeighborhoodBody,
  ) {
    const { actor, request } = this.info(req);
    const n = await this.geo.createNeighborhood(cityId, body, actor);
    this.audit.log({
      actor,
      action: 'geo.neighborhood.create',
      entityType: 'neighborhood',
      entityId: n.id,
      request,
    });
    return n;
  }

  @Patch('admin/cities/:cityId/neighborhoods/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async updateNeighborhood(
    @Req() req: Request,
    @Param('cityId') cityId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateNeighborhoodBodySchema)) body: UpdateNeighborhoodBody,
  ) {
    const { actor, request } = this.info(req);
    const n = await this.geo.updateNeighborhood(cityId, id, body, actor);
    this.audit.log({
      actor,
      action: 'geo.neighborhood.update',
      entityType: 'neighborhood',
      entityId: id,
      request,
    });
    return n;
  }

  @Delete('admin/cities/:cityId/neighborhoods/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async deleteNeighborhood(
    @Req() req: Request,
    @Param('cityId') cityId: string,
    @Param('id') id: string,
  ) {
    const { actor, request } = this.info(req);
    await this.geo.deleteNeighborhood(cityId, id, actor);
    this.audit.log({
      actor,
      action: 'geo.neighborhood.delete',
      entityType: 'neighborhood',
      entityId: id,
      request,
    });
    return { ok: true };
  }

  @Put('admin/cities/:cityId/neighborhoods/reorder')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.geo.write', limit: 60, windowSec: 60, scope: 'user' })
  async reorderNeighborhoods(
    @Req() req: Request,
    @Param('cityId') cityId: string,
    @Body(new ZodValidationPipe(reorderNeighborhoodsBodySchema)) body: ReorderNeighborhoodsBody,
  ) {
    const { actor, request } = this.info(req);
    await this.geo.reorderNeighborhoods(cityId, body, actor);
    this.audit.log({
      actor,
      action: 'geo.neighborhood.reorder',
      entityType: 'neighborhood',
      entityId: null,
      request,
    });
    return { ok: true };
  }
}
