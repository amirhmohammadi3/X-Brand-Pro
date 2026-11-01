import { Body, Controller, Post } from '@nestjs/common';
import { emailTestBodySchema, type EmailTestResult } from '@app/contracts';
import { RateLimit } from '../../common/decorators/rate-limit.decorator.js';
import { RequirePermissions } from '../../common/decorators/permissions.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
// EmailService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailService } from './email.service.js';

const TEST_TITLE = 'X-Brand-Pro test email';
const TEST_BODY =
  'If you can read this in your inbox, SMTP delivery works. اگر این پیام را می‌خوانید، ارسال ایمیل کار می‌کند.';

/**
 * Admin email test endpoint (B1.6). Sends the `generic` template through the
 * CURRENTLY configured SMTP transport synchronously (not queued) so an admin
 * can validate credentials from the panel. Transport failures come back as
 * `ok: false` with an errorCode — no 500.
 */
@Controller('admin/email')
export class EmailAdminController {
  constructor(private readonly email: EmailService) {}

  @RequirePermissions('settings.manage')
  @RateLimit({ name: 'admin.email.test', limit: 5, windowSec: 60, scope: 'user', failClosed: true })
  @Post('test')
  async sendTest(
    @Body(new ZodValidationPipe(emailTestBodySchema)) body: { to: string },
  ): Promise<EmailTestResult> {
    return this.email.sendNow(body.to, { title: TEST_TITLE, body: TEST_BODY });
  }
}
