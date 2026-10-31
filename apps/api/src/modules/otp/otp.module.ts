import { Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { WORKERS_SERVICE } from '../../queue/queue.module.js';
import type { WorkersService } from '../../queue/workers.service.js';
import { OTP_REPOSITORY, OtpRepository } from './otp.repository.js';
import { OtpService } from './otp.service.js';
import { registerOtpJobs } from './otp.jobs.js';

/**
 * OTP engine (B1.4). Sending (SMS/email) and HTTP endpoints arrive in
 * B1.5–B1.7; this module owns the code store, caps and the maintenance job.
 */
@Injectable()
export class OtpJobsInit implements OnModuleInit {
  constructor(
    private readonly otp: OtpService,
    @Inject(WORKERS_SERVICE) private readonly workers: WorkersService,
  ) {}

  onModuleInit(): void {
    // Inert in the API process (workers.startAll() is worker-only).
    registerOtpJobs(this.workers, this.otp);
  }
}

@Module({
  imports: [SettingsModule],
  providers: [{ provide: OTP_REPOSITORY, useClass: OtpRepository }, OtpService, OtpJobsInit],
  exports: [OtpService],
})
export class OtpModule {}
