import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { QA_REPOSITORY, QaRepository } from './qa.repository.js';
import { QaController } from './qa.controller.js';
import { QaService } from './qa.service.js';

/**
 * Business Q&A (B4.8): ask / edit / delete questions, the ONE owner answer
 * per question (upsert), moderation-view status filter. AuditModule supplies
 * the audit log for the write endpoints; AuthModule supplies TokenService
 * (the public list resolves the optional moderation caller from the bearer —
 * no session round trips).
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [QaController],
  providers: [{ provide: QA_REPOSITORY, useClass: QaRepository }, QaService],
  exports: [QaService],
})
export class QaModule {}
