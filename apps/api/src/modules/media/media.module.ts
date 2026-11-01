import { Global, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { registerMediaJobs } from './media.jobs.js';
import { MediaRepository, MEDIA_REPOSITORY } from './media.repository.js';
import { MediaController } from './media.controller.js';
import { MediaServingController } from './media-serving.controller.js';
import { MediaUrlService } from './media-url.service.js';
import { MediaService, MEDIA_SERVICE } from './media.service.js';

/**
 * Worker-side registration of the `media` processor (B1.9) — same inert-until-
 * worker pattern as EmailJobsInit (B1.6).
 */
@Injectable()
export class MediaJobsInit implements OnModuleInit {
  constructor(
    @Inject(MEDIA_SERVICE) private readonly media: MediaService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerMediaJobs(this.workers, this.media);
  }
}

/**
 * Media (B1.9): uploads, processing (sharp), serving. Global so later
 * prompts (avatars B1.10, business photos B2.7, reviews B4.x) inject
 * MediaService directly. StorageModule supplies the driver.
 */
@Global()
@Module({
  imports: [StorageModule],
  controllers: [MediaController, MediaServingController],
  providers: [
    { provide: MEDIA_REPOSITORY, useClass: MediaRepository },
    { provide: MEDIA_SERVICE, useClass: MediaService },
    MediaUrlService,
    MediaJobsInit,
  ],
  exports: [MEDIA_SERVICE, MediaUrlService],
})
export class MediaModule {}
