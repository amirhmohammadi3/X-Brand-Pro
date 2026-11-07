import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { GEO_REPOSITORY, GeoRepository } from './geo.repository.js';
import { BUSINESS_COUNTER, GeoService, type BusinessCounter } from './geo.service.js';
import { GeoController } from './geo.controller.js';
import { GeoAdminController } from './geo-admin.controller.js';

const repositoryProvider: Provider = { provide: GEO_REPOSITORY, useClass: GeoRepository };

/** Stub business counter: returns 0 until B2.4 registers the real one. */
const businessCounterStub: Provider = {
  provide: BUSINESS_COUNTER,
  useValue: {
    countByCity: async (_cityId: string): Promise<number> => 0,
  } satisfies BusinessCounter,
};

/**
 * Geo module (B2.1) — cities & neighborhoods catalog. Public anonymous reads
 * (cached) + admin CRUD (`catalog.manage`, audited). `BUSINESS_COUNTER` is an
 * optional provider that B2.4 overrides with the real per-city business count;
 * until then a stub returns 0 so the delete guard never trips.
 *
 * CacheService, DrizzleClient and EventEmitter2 are @Global / globally
 * registered, so only AuditModule (AUDIT_SERVICE) and SettingsModule
 * (geo.defaultCitySlug) need importing here — same shape as ThemeModule.
 */
@Module({
  imports: [AuditModule, SettingsModule],
  controllers: [GeoController, GeoAdminController],
  providers: [repositoryProvider, businessCounterStub, GeoService],
  exports: [GeoService],
})
export class GeoModule {}
