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
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request } from 'express';
import { uuidSchema } from '@app/contracts';
import {
  FAVORITE_READ_LIMIT_PER_MIN,
  FAVORITE_WRITE_LIMIT_PER_MIN,
  addFavoriteItemBodySchema,
  createFavoriteListBodySchema,
  favoriteListQuerySchema,
  favoriteStatusQuerySchema,
  updateFavoriteItemBodySchema,
  updateFavoriteListBodySchema,
  type AddFavoriteItemBody,
  type CreateFavoriteListBody,
  type FavoriteListQuery,
  type FavoriteStatusQuery,
  type UpdateFavoriteItemBody,
  type UpdateFavoriteListBody,
} from '@app/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FavoritesService } from './favorites.service.js';

/** The req.user shape set by JwtAuthGuard (this module has no @Public routes). */
function requireUser(req: Request): { id: string; role: string } {
  const user = (req as Request & { user?: { id: string; role: string } }).user;
  if (!user) throw new Error('JwtAuthGuard did not populate req.user on a protected route');
  return user;
}

/** Actor + request info for the audit row (mirrors qa.controller). */
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
 * Favorites endpoints (B5.1). Every route is authenticated (the global
 * JwtAuthGuard — no @Public here): favorites are private per-user data.
 * Reads are 60/min per user, writes 30/min per user (contracts constants);
 * every write is audited.
 *
 * Route layout:
 * - GET    /favorites/me                     — the lists (default first)
 * - GET    /favorites/me/check?businessId=   — the heart state
 * - POST   /favorites/items                  — heart-on (default list)
 * - PATCH  /favorites/items/:itemId          — move between lists / note
 * - DELETE /favorites/items/:itemId          — heart-off
 * - POST   /favorites/lists                  — new named list
 * - PATCH  /favorites/lists/:id              — rename
 * - DELETE /favorites/lists/:id              — delete (default → 422)
 * - GET    /favorites/lists/:id/items        — saved businesses as cards
 * - POST   /favorites/lists/:id/items        — save into a named list
 */
@Controller()
export class FavoritesController {
  constructor(
    private readonly favorites: FavoritesService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ─── Reads ───────────────────────────────────────────────────────────────

  @Get('favorites/me')
  @RateLimit({
    name: 'favorites.read',
    limit: FAVORITE_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listMine(@Req() req: Request) {
    const user = requireUser(req);
    return this.favorites.listMine(user.id);
  }

  @Get('favorites/me/check')
  @RateLimit({
    name: 'favorites.read',
    limit: FAVORITE_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async check(
    @Req() req: Request,
    @Query(new ZodValidationPipe(favoriteStatusQuerySchema)) query: FavoriteStatusQuery,
  ) {
    const user = requireUser(req);
    return this.favorites.status(user.id, query.businessId);
  }

  @Get('favorites/lists/:id/items')
  @RateLimit({
    name: 'favorites.read',
    limit: FAVORITE_READ_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async listItems(
    @Req() req: Request,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(favoriteListQuerySchema)) query: FavoriteListQuery,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'listId');
    return this.favorites.listItems(id, user, query);
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /** The heart-on shortcut — targets the caller's default list (lazy-created). */
  @Post('favorites/items')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async addItemToDefault(
    @Req() req: Request,
    @Body(new ZodValidationPipe(addFavoriteItemBodySchema)) body: AddFavoriteItemBody,
  ) {
    const user = requireUser(req);
    const item = await this.favorites.addToDefault(user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.add',
      entityType: 'business',
      entityId: body.businessId,
      after: { itemId: item.id, listId: item.listId, via: 'default' },
      request,
    });
    return item;
  }

  @Post('favorites/lists')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async createList(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createFavoriteListBodySchema)) body: CreateFavoriteListBody,
  ) {
    const user = requireUser(req);
    const list = await this.favorites.createList(user.id, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.list.create',
      entityType: 'favorite_list',
      entityId: list.id,
      after: { name: list.name },
      request,
    });
    return list;
  }

  @Post('favorites/lists/:id/items')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async addItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addFavoriteItemBodySchema)) body: AddFavoriteItemBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'listId');
    const item = await this.favorites.addItem(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.add',
      entityType: 'business',
      entityId: body.businessId,
      after: { itemId: item.id, listId: id },
      request,
    });
    return item;
  }

  @Patch('favorites/lists/:id')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async renameList(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFavoriteListBodySchema)) body: UpdateFavoriteListBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'listId');
    const list = await this.favorites.renameList(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.list.update',
      entityType: 'favorite_list',
      entityId: id,
      after: { name: list.name },
      request,
    });
    return list;
  }

  @Patch('favorites/items/:id')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async updateItem(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFavoriteItemBodySchema)) body: UpdateFavoriteItemBody,
  ) {
    const user = requireUser(req);
    assertUuid(id, 'itemId');
    const item = await this.favorites.updateItem(id, user, body);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.item.update',
      entityType: 'favorite',
      entityId: id,
      after: { listId: item.listId, noteChanged: body.note !== undefined },
      request,
    });
    return item;
  }

  @Delete('favorites/lists/:id')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async deleteList(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'listId');
    const result = await this.favorites.deleteList(id, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.list.delete',
      entityType: 'favorite_list',
      entityId: id,
      after: { deleted: result.deleted },
      request,
    });
    return result;
  }

  @Delete('favorites/items/:id')
  @RateLimit({
    name: 'favorites.write',
    limit: FAVORITE_WRITE_LIMIT_PER_MIN,
    windowSec: 60,
    scope: 'user',
  })
  async removeItem(@Req() req: Request, @Param('id') id: string) {
    const user = requireUser(req);
    assertUuid(id, 'itemId');
    const result = await this.favorites.removeItem(id, user);
    const { actor, request } = auditInfo(req);
    this.audit.log({
      actor,
      action: 'favorite.remove',
      entityType: 'favorite',
      entityId: id,
      after: { deleted: result.deleted },
      request,
    });
    return result;
  }
}
