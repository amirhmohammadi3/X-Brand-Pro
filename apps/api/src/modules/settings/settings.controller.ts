import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common';
import { updateSettingBodySchema, settingKeySchema, type AdminSetting } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedHttpRequest } from '../auth/jwt-auth.guard.js';
// SettingsService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from './settings.service.js';

/** Admin view of the settings registry, grouped for the panel UI (B1.11). */
export interface GroupedSettingsView {
  groups: Record<string, AdminSetting[]>;
}

/**
 * Settings endpoints (B1.1, upgraded by B1.11). Admin routes now run through
 * the permission system (`settings.manage`) with a 60/min per-user limiter;
 * the actor travels into the service so the audit event carries who changed
 * what. The public blob is rate-limited and cached.
 */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @RateLimit({ name: 'settings.public', limit: 60, windowSec: 60 })
  @Get('settings/public')
  async getPublicSettings(): Promise<Record<string, unknown>> {
    return this.settings.getPublic();
  }

  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.settings.read', limit: 60, windowSec: 60, scope: 'user' })
  @Get('admin/settings')
  async listSettings(): Promise<GroupedSettingsView> {
    const flat = await this.settings.listAll();
    const groups: Record<string, AdminSetting[]> = {};
    for (const setting of flat) {
      (groups[setting.group] ??= []).push(setting);
    }
    return { groups };
  }

  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.settings.write', limit: 60, windowSec: 60, scope: 'user' })
  @Put('admin/settings/:key')
  async updateSetting(
    @Req() req: AuthenticatedHttpRequest,
    @Param('key', new ZodValidationPipe(settingKeySchema)) key: string,
    @Body(new ZodValidationPipe(updateSettingBodySchema))
    body: { value?: unknown; clear?: boolean },
  ): Promise<AdminSetting> {
    return this.settings.set(key, body.value, {
      id: req.user?.id ?? null,
      role: req.user?.role ?? null,
      clear: body.clear === true,
    });
  }

  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.settings.write', limit: 60, windowSec: 60, scope: 'user' })
  @Delete('admin/settings/:key')
  async resetSetting(
    @Req() req: AuthenticatedHttpRequest,
    @Param('key', new ZodValidationPipe(settingKeySchema)) key: string,
  ): Promise<AdminSetting> {
    return this.settings.reset(key, {
      id: req.user?.id ?? null,
      role: req.user?.role ?? null,
    });
  }
}
