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
  createCategoryBodySchema,
  reorderCategoriesBodySchema,
  setActiveCityBodySchema,
  updateCategoryBodySchema,
  type CreateCategoryBody,
  type ReorderCategoriesBody,
  type SetActiveCityBody,
  type UpdateCategoryBody,
} from '@app/contracts';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CategoriesService } from './categories.service.js';

/**
 * Admin category endpoints (B2.2). Every route requires `catalog.manage`, is
 * rate-limited to 60/min per user, and writes an audit row. Two-level tree CRUD
 * with depth + move rules; delete refuses when children or businesses exist.
 */
@Controller()
export class CategoriesAdminController {
  constructor(
    private readonly cats: CategoriesService,
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

  @Get('admin/categories')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.read', limit: 60, windowSec: 60, scope: 'user' })
  async list() {
    return { items: await this.cats.listAdminCategories() };
  }

  @Post('admin/categories')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async create(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createCategoryBodySchema)) body: CreateCategoryBody,
  ) {
    const { actor, request } = this.info(req);
    const cat = await this.cats.createCategory(body, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.create',
      entityType: 'category',
      entityId: cat.id,
      request,
    });
    return cat;
  }

  @Patch('admin/categories/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategoryBodySchema)) body: UpdateCategoryBody,
  ) {
    const { actor, request } = this.info(req);
    const cat = await this.cats.updateCategory(id, body, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.update',
      entityType: 'category',
      entityId: id,
      request,
    });
    return cat;
  }

  @Delete('admin/categories/:id')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const { actor, request } = this.info(req);
    await this.cats.deleteCategory(id, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.delete',
      entityType: 'category',
      entityId: id,
      request,
    });
    return { ok: true };
  }

  @Put('admin/categories/:id/active')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async setActive(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setActiveCityBodySchema)) body: SetActiveCityBody,
  ) {
    const { actor, request } = this.info(req);
    const cat = await this.cats.setCategoryActive(id, body.isActive, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.set_active',
      entityType: 'category',
      entityId: id,
      after: { isActive: body.isActive },
      request,
    });
    return cat;
  }

  @Put('admin/categories/reorder')
  @RequirePermissions('catalog.manage')
  @RateLimit({ name: 'admin.catalog.write', limit: 60, windowSec: 60, scope: 'user' })
  async reorder(
    @Req() req: Request,
    @Body(new ZodValidationPipe(reorderCategoriesBodySchema)) body: ReorderCategoriesBody,
  ) {
    const { actor, request } = this.info(req);
    await this.cats.reorderCategories(body, actor);
    this.audit.log({
      actor,
      action: 'catalog.category.reorder',
      entityType: 'category',
      entityId: null,
      request,
    });
    return { ok: true };
  }
}
