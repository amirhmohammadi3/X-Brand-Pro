import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { registerReviewsJobs } from './reviews.jobs.js';
import { REVIEWS_REPOSITORY, ReviewsRepository } from './reviews.repository.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';
import { ReviewsRatingSubscriber } from './reviews-rating.subscriber.js';

/**
 * Worker-side registration of the `reviews` processor (B4.1) — same
 * inert-until-worker pattern as MediaJobsInit (B1.9).
 */
@Injectable()
export class ReviewsJobsInit implements OnModuleInit {
  constructor(
    private readonly reviews: ReviewsService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerReviewsJobs(this.workers, this.reviews);
  }
}

/**
 * Reviews (B4.1): CRUD + photo + the asynchronous rating aggregate.
 * MediaModule is global (B1.9) so MediaRepository/MediaUrlService inject
 * directly; AuditModule supplies the audit log for the write endpoints.
 */
@Module({
  // AuthModule supplies TokenService (the public list resolves the optional
  // moderation caller from the bearer — no session round trips).
  imports: [AuditModule, AuthModule],
  controllers: [ReviewsController],
  providers: [
    { provide: REVIEWS_REPOSITORY, useClass: ReviewsRepository },
    ReviewsService,
    ReviewsRatingSubscriber,
    ReviewsJobsInit,
  ],
  exports: [ReviewsService],
})
export class ReviewsModule {}
