import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { EmailModule } from '../email/email.module.js';
import { I18nModule } from '../i18n/i18n.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { NOTIFICATIONS_REPOSITORY, NotificationsRepository } from './notifications.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import {
  PUSH_SUBSCRIPTIONS_REPOSITORY,
  PushSubscriptionsRepository,
} from './push/push-subscriptions.repository.js';
import { PUSH_SENDER, PushService } from './push/push.service.js';

/**
 * Notification core (B5.3): the event catalog, per-user channel
 * preferences, the in-app inbox and the fail-soft `notify()` entry point
 * that renders translatable i18n templates and fans out to the email (B1.6)
 * and SMS (B1.5) queue-backed channels.
 *
 * EmailModule/SmsModule supply the ENQUEUE-only services (no SMTP/provider
 * driver is touched in the request path); I18nModule supplies the
 * server-side translate() the templates render with. Web push (B5.4) lives
 * in push/ — the subscription store (one row per browser endpoint, upserted
 * on re-subscribe, self-cleaning on the 404/410 lifecycle), the VAPID
 * identity read at send time from the settings registry (push.vapid.*)
 * and the fail-soft sender wired into notify() via the PUSH_SENDER
 * contract (useExisting keeps one instance).
 *
 * The service is EXPORTED — B5.7's event subscribers inject it.
 */
@Module({
  imports: [AuditModule, EmailModule, SmsModule, I18nModule, SettingsModule],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATIONS_REPOSITORY, useClass: NotificationsRepository },
    NotificationsService,
    { provide: PUSH_SUBSCRIPTIONS_REPOSITORY, useClass: PushSubscriptionsRepository },
    PushService,
    { provide: PUSH_SENDER, useExisting: PushService },
  ],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
