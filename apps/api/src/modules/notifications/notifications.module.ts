import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { EmailModule } from '../email/email.module.js';
import { I18nModule } from '../i18n/i18n.module.js';
import { QaModule } from '../qa/qa.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SmsModule } from '../sms/sms.module.js';
import { UsersModule } from '../users/users.module.js';
import { NOTIFICATIONS_REPOSITORY, NotificationsRepository } from './notifications.repository.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsEventsSubscriber } from './notifications-events.subscriber.js';
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
 * B5.7 adds NotificationsEventsSubscriber: the module now imports
 * Reviews/Qa/Business/Users for their EXPORTED REPOSITORY tokens (the
 * recipient lookups must not detour through services' DTO mapping) and
 * consumes the EXISTING domain events through the @Global EventEmitter2.
 * None of those modules imports this one, so the graph stays cycle-free;
 * the source modules never learn notifications exist.
 *
 * The service is EXPORTED — B5.7's event subscribers inject it.
 */
@Module({
  imports: [
    AuditModule,
    EmailModule,
    SmsModule,
    I18nModule,
    SettingsModule,
    UsersModule,
    BusinessModule,
    ReviewsModule,
    QaModule,
  ],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATIONS_REPOSITORY, useClass: NotificationsRepository },
    NotificationsService,
    { provide: PUSH_SUBSCRIPTIONS_REPOSITORY, useClass: PushSubscriptionsRepository },
    PushService,
    { provide: PUSH_SENDER, useExisting: PushService },
    NotificationsEventsSubscriber,
  ],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
