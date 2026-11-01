import { Module } from '@nestjs/common';
import { AuditAdminController } from './audit-admin.controller.js';
import { AuditService, AUDIT_SERVICE } from './audit.service.js';
import { AuditRepository, AUDIT_REPOSITORY } from './audit.repository.js';
import { AuthAuditSubscriber } from './auth-audit.subscriber.js';

/**
 * Audit module (B1.11). AuthAuditSubscriber listens to auth/settings domain
 * events; domain modules can also inject AuditService directly for their own
 * sensitive actions (moderation, payments — later prompts). ONE instance is
 * provided: under the class token, aliased to AUDIT_SERVICE.
 */
@Module({
  controllers: [AuditAdminController],
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: AuditRepository },
    AuditService,
    { provide: AUDIT_SERVICE, useExisting: AuditService },
    AuthAuditSubscriber,
  ],
  exports: [AuditService, AUDIT_SERVICE],
})
export class AuditModule {}
