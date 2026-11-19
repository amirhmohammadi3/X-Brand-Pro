import { Module, type Provider } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AiCallsRepository, AI_CALLS_REPOSITORY } from './ai-calls.repository.js';
import { AiAdminController } from './ai-admin.controller.js';
import { AiService } from './ai.service.js';
import { AI_DRIVER } from './ai-driver.interface.js';
import { FakeAiDriver } from './fake-ai.driver.js';
import { OpenAiDriver } from './openai-ai.driver.js';
import { RuleAiDriver } from './rule-ai.driver.js';

/**
 * AI module (Phase 9). Wires the three drivers + the service + the
 * repository + the admin controller. The drivers are all provided as
 * plain classes so the service can inject any of them (the configured
 * driver is selected by the service at call time, reading the
 * `ai.driver` setting).
 *
 * `SettingsModule` is imported so SettingsService is available — the
 * service reads 12 settings keys on every call (through the cache). The
 * SettingsModule also re-exports CacheService's consumer-facing bits if
 * needed; the global RedisModule covers CacheService regardless.
 *
 * The `AI_DRIVER` token is bound to a factory that picks the driver based
 * on the `ai.driver` setting at boot — BUT the service actually re-reads
 * the setting on every call (so an admin change takes effect without a
 * restart), and falls back to the rule driver if the configured driver is
 * unavailable. The `AI_DRIVER` token is the INITIAL driver (used for the
 * first call before the cache warms); subsequent calls bypass it.
 */
const driverProvider: Provider = {
  provide: AI_DRIVER,
  useFactory: () => {
    // The boot-time driver — defaults to the fake driver. The service
    // re-reads the `ai.driver` setting on every call so an admin change
    // takes effect without a restart. This factory exists mainly so the
    // AI_DRIVER token has a binding (the service reads settings first).
    return new FakeAiDriver();
  },
};

const repositoryProvider: Provider = {
  provide: AI_CALLS_REPOSITORY,
  useClass: AiCallsRepository,
};

@Module({
  imports: [SettingsModule],
  controllers: [AiAdminController],
  providers: [
    driverProvider,
    repositoryProvider,
    FakeAiDriver,
    OpenAiDriver,
    RuleAiDriver,
    AiService,
  ],
  exports: [AiService],
})
export class AiModule {}
