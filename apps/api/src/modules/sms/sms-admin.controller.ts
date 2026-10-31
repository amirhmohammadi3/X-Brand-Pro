import { Body, Controller, Post } from '@nestjs/common';
import { smsTestBodySchema, type SmsTestResult } from '@app/contracts';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// SmsService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SmsService } from './sms.service.js';

const TEST_MESSAGE = 'X-Brand-Pro test message — if you received this, SMS delivery works.';

/**
 * Admin SMS test endpoint (B1.5). Sends a fixed message through the
 * CURRENTLY configured provider synchronously (not queued) so an admin can
 * validate credentials from the panel. Provider failures (including
 * missing credentials) come back as `ok: false` with an errorCode — no 500.
 */
@Controller('admin/sms')
export class SmsAdminController {
  constructor(private readonly sms: SmsService) {}

  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.sms.test', limit: 5, windowSec: 60, scope: 'user', failClosed: true })
  @Post('test')
  async sendTest(
    @Body(new ZodValidationPipe(smsTestBodySchema)) body: { to: string },
  ): Promise<SmsTestResult> {
    return this.sms.sendNow(body.to, TEST_MESSAGE);
  }
}
