import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { MailJobData } from './email.service.js';
import { MAIL_QUEUE, type EmailService } from './email.service.js';

const logger = new Logger('EmailJobs');

/**
 * Worker-side registration of the `mail` processor (B1.6). Called from
 * EmailModule's onModuleInit — registration is inert in the API process
 * (startAll() only runs in the worker) and safe to repeat across restarts.
 */
export function registerEmailJobs(workers: WorkersService, email: EmailService): void {
  workers.register(MAIL_QUEUE, async (job) => {
    if (job.name !== 'send') {
      logger.warn(`ignoring unknown mail job name "${job.name}"`);
      return;
    }
    await email.deliver(job.data as MailJobData);
  });
}
