import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EmailModule } from '../email/email.module.js';
import { I18nModule } from '../i18n/i18n.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NOTIFICATIONS_REPOSITORY, NotificationsRepository } from './notifications.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notification core (B5.3): the event catalog, per-user channel
 * preferences, the in-app inbox and the fail-soft `notify()` entry point
 * that renders translatable i18n templates and fans out to the email (B1.6)
 * and SMS (B1.5) queue-backed channels.
 *
 * EmailModule/SmsModule supply the ENQUEUE-only services (no SMTP/provider
 * driver is touched in the request path); I18nModule supplies the
 * server-side translate() the templates render with. Web push (B5.4) will
 * consume the same resolveChannels matrix.
 *
 * The service is EXPORTED — B5.7's event subscribers inject it.
 */
@Module({
  imports: [AuditModule, EmailModule, SmsModule, I18nModule],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATIONS_REPOSITORY, useClass: NotificationsRepository },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
