import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { MODERATION_REPOSITORY, ModerationRepository } from './moderation.repository.js';
import { ModerationController } from './moderation.controller.js';
import { ModerationService } from './moderation.service.js';

/**
 * Moderation (B4.4): abuse reports + the content moderation queues.
 * ReviewsModule supplies ReviewsService (the review status flip + its
 * queue list — the aggregate-recompute path stays in ONE place);
 * AuditModule supplies the audit log. The repository reads the shared
 * schema directly for the polymorphic target existence checks.
 */
@Module({
  imports: [AuditModule, ReviewsModule],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    { provide: MODERATION_REPOSITORY, useClass: ModerationRepository },
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
