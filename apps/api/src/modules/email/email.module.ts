import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { SmtpDriver } from './drivers/smtp.driver.js';
import { registerEmailJobs } from './email.jobs.js';
import { EmailCredentialsService } from './email-credentials.service.js';
import { EmailAdminController } from './email-admin.controller.js';
import { EmailService, SMTP_DRIVER } from './email.service.js';

/**
 * Worker-side registration of the `mail` processor (B1.6). Inert in the API
 * process: workers.startAll() only runs from src/worker.ts.
 */
@Injectable()
export class EmailJobsInit implements OnModuleInit {
  constructor(
    private readonly email: EmailService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerEmailJobs(this.workers, this.email);
  }
}

/**
 * Email delivery (B1.6): nodemailer SMTP driver behind the EmailDriver
 * interface, rendered from inline fa/en templates, queued on `mail`.
 * Global like RedisModule/DrizzleModule: auth (B1.7 verification mails),
 * notifications (B5.x) and future modules all inject EmailService — the
 * SMTP driver token is exported for the health indicator, which lives in
 * the HealthModule context.
 */
@Global()
@Module({
  imports: [SettingsModule],
  controllers: [EmailAdminController],
  providers: [
    EmailCredentialsService,
    { provide: SMTP_DRIVER, useClass: SmtpDriver },
    EmailService,
    EmailJobsInit,
  ],
  exports: [EmailService, SMTP_DRIVER],
})
export class EmailModule {}
