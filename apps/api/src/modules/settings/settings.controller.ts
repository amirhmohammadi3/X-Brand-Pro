import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { updateSettingBodySchema, settingKeySchema } from '@app/contracts';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// SettingsService is constructor-injected: Nest reads its type at runtime
// from emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from './settings.service.js';

/**
 * Settings endpoints (B1.1). Admin routes are guarded by @Roles and denied
 * until B1.2/B1.3 provide authentication (see RolesGuard). The public blob
 * is rate-limited and cached.
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

  @Roles('admin', 'super_admin')
  @Get('admin/settings')
  async listSettings() {
    return this.settings.listAll();
  }

  @Roles('admin', 'super_admin')
  @Put('admin/settings/:key')
  async updateSetting(
    @Param('key', new ZodValidationPipe(settingKeySchema)) key: string,
    @Body(new ZodValidationPipe(updateSettingBodySchema)) body: { value?: unknown },
  ) {
    return this.settings.set(key, body.value);
  }

  @Roles('admin', 'super_admin')
  @Delete('admin/settings/:key')
  async resetSetting(@Param('key', new ZodValidationPipe(settingKeySchema)) key: string) {
    return this.settings.reset(key);
  }
}
