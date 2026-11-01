import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  setActiveThemeBodySchema,
  updateThemeTokensBodySchema,
  type ActiveTheme,
  type SetActiveThemeBody,
  type ThemePack,
  type UpdateThemeTokensBody,
} from '@app/contracts';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.service.js';
import { Inject } from '@nestjs/common';
// ThemeService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ThemeService } from './theme.service.js';

/**
 * Theme endpoints (B1.13).
 * Public: active pack, pack list with previews, one full pack.
 * Admin (`theme.manage` + audit, 30/min per user): switch active pack,
 * replace tokens, reset to shipped values.
 */
@Controller()
export class ThemeController {
  constructor(
    private readonly theme: ThemeService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  private auditInfo(req: Request): {
    actorId: string | null;
    ip: string | null;
    userAgent: string | null;
    requestId: string | null;
  } {
    const user = (req as Request & { user?: { id: string; role: string } }).user;
    const ua = req.headers['user-agent'];
    const rid = req.headers['x-request-id'];
    return {
      actorId: user?.id ?? null,
      ip: req.ip ?? null,
      userAgent: Array.isArray(ua) ? (ua[0] ?? null) : (ua ?? null),
      requestId: typeof rid === 'string' ? rid : null,
    };
  }

  @Get('theme')
  @RateLimit({ name: 'theme.active', limit: 120, windowSec: 60 })
  async getActive(): Promise<ActiveTheme> {
    return this.theme.getActive();
  }

  @Get('theme/packs')
  @RateLimit({ name: 'theme.list', limit: 60, windowSec: 60 })
  async listPacks() {
    return { items: await this.theme.listPacks() };
  }

  @Get('theme/packs/:id')
  @RateLimit({ name: 'theme.pack', limit: 60, windowSec: 60 })
  async getPack(@Param('id') id: string): Promise<ThemePack> {
    return this.theme.getPack(id);
  }

  @Put('admin/theme/active')
  @RequirePermissions('theme.manage')
  @RateLimit({ name: 'admin.theme.write', limit: 30, windowSec: 60, scope: 'user' })
  async setActive(
    @Req() req: Request,
    @Body(new ZodValidationPipe(setActiveThemeBodySchema)) body: SetActiveThemeBody,
  ): Promise<ActiveTheme> {
    const info = this.auditInfo(req);
    const active = await this.theme.setActive(body.packId, info.actorId);
    this.audit.log({
      actor: {
        id: info.actorId,
        role: (req as Request & { user?: { role: string } }).user?.role ?? null,
      },
      action: 'theme.active.set',
      entityType: 'theme_pack',
      entityId: body.packId,
      request: { ip: info.ip, userAgent: info.userAgent, requestId: info.requestId },
    });
    return active;
  }

  @Put('admin/theme/packs/:id')
  @RequirePermissions('theme.manage')
  @RateLimit({ name: 'admin.theme.write', limit: 30, windowSec: 60, scope: 'user' })
  async updateTokens(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateThemeTokensBodySchema)) body: UpdateThemeTokensBody,
  ): Promise<ThemePack> {
    const info = this.auditInfo(req);
    const pack = await this.theme.updateTokens(id, body.tokens, info.actorId);
    this.audit.log({
      actor: {
        id: info.actorId,
        role: (req as Request & { user?: { role: string } }).user?.role ?? null,
      },
      action: 'theme.tokens.update',
      entityType: 'theme_pack',
      entityId: id,
      after: { version: pack.version },
      request: { ip: info.ip, userAgent: info.userAgent, requestId: info.requestId },
    });
    return pack;
  }

  @Post('admin/theme/packs/:id/reset')
  @RequirePermissions('theme.manage')
  @RateLimit({ name: 'admin.theme.write', limit: 30, windowSec: 60, scope: 'user' })
  async resetPack(@Req() req: Request, @Param('id') id: string): Promise<ThemePack> {
    const info = this.auditInfo(req);
    const pack = await this.theme.resetToDefault(id, info.actorId);
    this.audit.log({
      actor: {
        id: info.actorId,
        role: (req as Request & { user?: { role: string } }).user?.role ?? null,
      },
      action: 'theme.pack.reset',
      entityType: 'theme_pack',
      entityId: id,
      after: { version: pack.version },
      request: { ip: info.ip, userAgent: info.userAgent, requestId: info.requestId },
    });
    return pack;
  }
}
