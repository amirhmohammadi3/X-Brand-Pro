import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { GEO_REPOSITORY, GeoRepository } from './geo.repository.js';
import { GeoService } from './geo.service.js';
import { GeoController } from './geo.controller.js';
import { GeoAdminController } from './geo-admin.controller.js';

const repositoryProvider: Provider = { provide: GEO_REPOSITORY, useClass: GeoRepository };

/**
 * Geo module (B2.1) — cities & neighborhoods catalog. Public anonymous reads
 * (cached) + admin CRUD (`catalog.manage`, audited). `BUSINESS_COUNTER` is
 * provided by BusinessModule (B2.4) and resolves to the real per-city business
 * count; the delete guard now refuses when a city has businesses.
 *
 * CacheService, DrizzleClient and EventEmitter2 are @Global / globally
 * registered, so only AuditModule (AUDIT_SERVICE) and SettingsModule
 * (geo.defaultCitySlug) plus BusinessModule (BUSINESS_COUNTER) need importing.
 */
@Module({
  imports: [AuditModule, SettingsModule, BusinessModule],
  controllers: [GeoController, GeoAdminController],
  providers: [repositoryProvider, GeoService],
  exports: [GeoService],
})
export class GeoModule {}
