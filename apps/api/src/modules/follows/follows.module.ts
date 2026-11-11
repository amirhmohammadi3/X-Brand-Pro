import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { MediaModule } from '../media/media.module.js';
import { FOLLOWS_REPOSITORY, FollowsRepository } from './follows.repository.js';
import { FollowsActivitySubscriber } from './follows-activity.subscriber.js';
import { FollowsController } from './follows.controller.js';
import { FollowsService } from './follows.service.js';

/**
 * Follows + the activity feed (B5.2): the storage model (one follows table
 * for user AND business targets, one append-only activity_events table),
 * the follow/unfollow flows, the /follows/me card lists and the pull-based
 * /feed read — every follow write audited.
 *
 * The activity subscriber is registered HERE (not in the source modules):
 * it consumes the reviews/qa/favorites domain events through the @Global
 * EventEmitter2, so reviews/qa/favorites never learn this module exists —
 * the wiring stays one-directional and cycle-free.
 *
 * BusinessModule supplies BUSINESSES_REPOSITORY (B2.4 cards for
 * /follows/me); MediaModule supplies MediaUrlService (avatar URLs).
 * EventEmitter2 is @Global; AuditModule is imported (not @Global) so the
 * controller can inject AUDIT_SERVICE.
 */
@Module({
  imports: [BusinessModule, AuditModule, MediaModule],
  controllers: [FollowsController],
  providers: [
    { provide: FOLLOWS_REPOSITORY, useClass: FollowsRepository },
    FollowsService,
    FollowsActivitySubscriber,
  ],
  exports: [FollowsService],
})
export class FollowsModule {}
