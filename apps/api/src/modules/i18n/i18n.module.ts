import { Global, Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { I18nAdminController } from './i18n-admin.controller.js';
import { I18nController } from './i18n.controller.js';
import { I18N_REPOSITORY, I18nRepository } from './i18n.repository.js';
import { I18nService } from './i18n.service.js';
import { LocaleValidator } from './locale.validator.js';

const repositoryProvider: Provider = {
  provide: I18N_REPOSITORY,
  useClass: I18nRepository,
};

/**
 * i18n module (B1.12) — languages, translations, bundles, admin management.
 *
 * Global so any module can inject `I18nService` (server-side message
 * translation for mail/SMS/notification templates) and the DB-backed
 * `LocaleValidator` without importing plumbing.
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [I18nController, I18nAdminController],
  providers: [repositoryProvider, I18nService, LocaleValidator],
  exports: [I18nService, LocaleValidator],
})
export class I18nModule {}
