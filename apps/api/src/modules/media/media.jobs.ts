import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { WorkersService } from '../../queue/workers.service.js';
import {
  MEDIA_CLEANUP_JOB,
  MEDIA_QUEUE,
  MEDIA_CLEANUP_EVERY_MS,
  type MediaService,
} from './media.service.js';

const logger = new Logger('MediaJobs');

const deleteJobSchema = z.object({ keys: z.array(z.string().min(1)).min(1) });

/**
 * Worker-side registration of the `media` queue (B1.9):
 * - `delete` jobs remove the stored files of a soft-deleted media row;
 * - the hourly repeatable `media:cleanup-orphans` sweeps uploads that were
 *   never attached within 24 h (files AND rows).
 * Registration is inert in the API process (startAll() runs only in the
 * worker) and safe to repeat across restarts — BullMQ dedupes the schedule.
 */
export function registerMediaJobs(workers: WorkersService, media: MediaService): void {
  workers.register(MEDIA_QUEUE, async (job) => {
    if (job.name === 'delete') {
      const parsed = deleteJobSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn(`ignoring malformed media delete job: ${parsed.error.message}`);
        return;
      }
      await media.deleteFiles(parsed.data.keys);
      return;
    }
    if (job.name === MEDIA_CLEANUP_JOB) {
      const removed = await media.cleanupOrphans();
      if (removed > 0) logger.log(`cleanup-orphans removed ${removed} media rows`);
      return;
    }
    logger.warn(`ignoring unknown media job name "${job.name}"`);
  });
  workers.registerRepeatable(MEDIA_QUEUE, MEDIA_CLEANUP_JOB, {}, MEDIA_CLEANUP_EVERY_MS);
}
