import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { MediaModule } from '../media/media.module.js';
import { MessagingController } from './messaging.controller.js';
import { MESSAGING_REPOSITORY, MessagingRepository } from './messaging.repository.js';
import { MessagingService } from './messaging.service.js';

/**
 * Messaging (B5.6): DM conversations, read receipts, media attachments,
 * blocks and message reports. Every route is authenticated + rate-limited
 * (reads 60/min, writes 30/min, block/report 30/min — contracts constants).
 *
 * Emit path: the service emits `messaging.message.created` /
 * `messaging.message.deleted` through the @Global EventEmitter2; the
 * REALTIME module subscribes and fans the pushes out (the transport stays
 * one-directional — this module never imports RealtimeModule, so no cycle
 * exists even though RealtimeModule imports THIS module for the gateway's
 * conversation-membership probe).
 *
 * MediaModule is @Global (MediaService + MediaUrlService injectable);
 * AuditModule is imported so the controller can inject AUDIT_SERVICE for
 * the block/report audit rows.
 */
@Module({
  imports: [AuditModule, MediaModule],
  controllers: [MessagingController],
  providers: [{ provide: MESSAGING_REPOSITORY, useClass: MessagingRepository }, MessagingService],
  // MESSAGING_REPOSITORY is what RealtimeGateway probes for the
  // `conversation:<id>` room membership (join = participant, no more).
  exports: [MESSAGING_REPOSITORY, MessagingService],
})
export class MessagingModule {}
