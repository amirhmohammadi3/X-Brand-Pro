import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { REDIS } from '../../redis/redis.client.js';
import type { RedisLike } from '../../redis/redis.client.js';
import { FakeSmsDriver } from './drivers/fake.driver.js';
import { KavenegarDriver } from './drivers/kavenegar.driver.js';
import { MelipayamakDriver } from './drivers/melipayamak.driver.js';
import { registerSmsJobs } from './sms.jobs.js';
import { SmsCredentialsService } from './sms-credentials.service.js';
import {
  SmsService,
  SMS_DRIVER_FAKE,
  SMS_DRIVER_KAVENEGAR,
  SMS_DRIVER_MELIPAYAMAK,
} from './sms.service.js';
import { SmsAdminController } from './sms-admin.controller.js';
import { DevSmsController } from './dev-sms.controller.js';

/**
 * Registers the `sms` queue processor on the worker side (B1.5). Inert in
 * the API process: workers.startAll() only runs from src/worker.ts.
 */
@Injectable()
export class SmsJobsInit implements OnModuleInit {
  constructor(
    private readonly sms: SmsService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    registerSmsJobs(this.workers, this.sms);
  }
}

/**
 * SMS delivery (B1.5): interface + fake driver + Melipayamak/Kavenegar REST
 * drivers, provider selected at send time from `sms.provider`. The dev
 * outbox controller ships in DevSmsModule (app.module.ts) so it can be
 * registered conditionally on DEV_TOOLS.
 */
@Module({
  imports: [SettingsModule],
  controllers: [SmsAdminController],
  providers: [
    SmsCredentialsService,
    {
      provide: SMS_DRIVER_FAKE,
      inject: [REDIS],
      useFactory: (redis: RedisLike) => new FakeSmsDriver(redis),
    },
    { provide: SMS_DRIVER_MELIPAYAMAK, useClass: MelipayamakDriver },
    { provide: SMS_DRIVER_KAVENEGAR, useClass: KavenegarDriver },
    SmsService,
    SmsJobsInit,
  ],
  exports: [SmsService],
})
export class SmsModule {}

/**
 * Dev-only module (B1.5): registered in app.module.ts ONLY when DEV_TOOLS is
 * true and NODE_ENV is not production. The controller reads the Redis outbox
 * list the fake driver wrote; REDIS comes from the global RedisModule.
 */
@Module({
  controllers: [DevSmsController],
})
export class DevSmsModule {}
