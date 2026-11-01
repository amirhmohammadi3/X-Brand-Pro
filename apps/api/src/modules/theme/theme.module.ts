import { Module } from '@nestjs/common';
import { type Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { THEME_REPOSITORY, ThemeRepository } from './theme.repository.js';
import { ThemeService } from './theme.service.js';
import { ThemeController } from './theme.controller.js';

const repositoryProvider: Provider = {
  provide: THEME_REPOSITORY,
  useClass: ThemeRepository,
};

/**
 * Theme module (B1.13) — theme packs, active-pack setting, admin editing
 * with server-side contrast validation. Exports ThemeService so later
 * prompts (F1.2 token engine) and the admin panel can resolve packs.
 */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [ThemeController],
  providers: [repositoryProvider, ThemeService],
  exports: [ThemeService],
})
export class ThemeModule {}
