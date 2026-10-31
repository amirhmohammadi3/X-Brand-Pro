import { Module, type Provider } from '@nestjs/common';
import { SettingsRepository } from './settings.repository.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService, SETTINGS_REPOSITORY } from './settings.service.js';

/**
 * Settings module (B1.1). The repository is provided under a symbol token so
 * unit tests can substitute a fake; the Drizzle-backed implementation is the
 * production binding.
 */
const repositoryProvider: Provider = {
  provide: SETTINGS_REPOSITORY,
  useClass: SettingsRepository,
};

@Module({
  controllers: [SettingsController],
  providers: [repositoryProvider, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
