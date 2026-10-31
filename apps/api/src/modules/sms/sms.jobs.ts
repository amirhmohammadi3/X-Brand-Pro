import { Logger } from '@nestjs/common';
import type { WorkersService } from '../../queue/workers.service.js';
import type { SmsMessage } from './sms.driver.js';
import { SMS_QUEUE, type SmsService } from './sms.service.js';

const logger = new Logger('SmsJobs');

/**
 * Worker-side registration of the `sms` processor (B1.5). Called from
 * SmsModule's onModuleInit — registration is inert in the API process
 * (startAll() only runs in the worker) and safe to repeat across restarts.
 */
export function registerSmsJobs(workers: WorkersService, sms: SmsService): void {
  workers.register(SMS_QUEUE, async (job) => {
    // Every sms job is a `send` today; unknown names are logged and dropped.
    if (job.name !== 'send') {
      logger.warn(`ignoring unknown sms job name "${job.name}"`);
      return;
    }
    await sms.deliver(job.data as SmsMessage);
  });
}
