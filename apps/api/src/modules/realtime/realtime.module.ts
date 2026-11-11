import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { UsersModule } from '../users/users.module.js';
import { RealtimeAuthService } from './realtime-auth.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeMessagingSubscriber } from './realtime-messaging.subscriber.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Realtime module (B5.5, B5.6): the Socket.IO gateway + its auth chain +
 * the emit surface other modules push through. Imports Auth/Users/Business
 * ONLY for their exported services/repositories (no cycles — none of them
 * imports this module; B5.7's event subscribers will inject
 * RealtimeService from their own modules instead).
 *
 * B5.6 adds MessagingModule for exactly two things: the gateway probes
 * MESSAGING_REPOSITORY for `conversation:<id>` room membership, and
 * RealtimeMessagingSubscriber forwards the messaging domain events into
 * the rooms. Messaging never imports this module (it emits through the
 * @Global EventEmitter2), so the dependency stays one-directional.
 */
@Module({
  imports: [AuthModule, UsersModule, BusinessModule, MessagingModule],
  providers: [RealtimeService, RealtimeAuthService, RealtimeGateway, RealtimeMessagingSubscriber],
  exports: [RealtimeService],
})
export class RealtimeModule {}
