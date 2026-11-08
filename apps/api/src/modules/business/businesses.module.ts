import { Module, type Provider } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { BUSINESSES_REPOSITORY, BusinessesRepository } from './businesses.repository.js';
import { BusinessDomainService } from './businesses.domain.js';
import { BusinessCounters } from './businesses.counters.js';
import { BUSINESS_COUNTER } from '../geo/geo.service.js';
import { CATEGORY_BUSINESS_COUNTER } from '../catalog/categories/categories.service.js';
import { AMENITY_USAGE_COUNTER } from '../catalog/amenities/amenities.service.js';

/**
 * Business catalog module (B2.4) — the core business data model: schema,
 * repository and domain rules (status state machine, location-in-bbox, slug,
 * contact normalisers). No HTTP here (B2.6 owns the CRUD endpoints).
 *
 * Binds the three counter providers (`BUSINESS_COUNTER`, `CATEGORY_BUSINESS_COUNTER`,
 * `AMENITY_USAGE_COUNTER`) that B2.1–B2.3 declared as stubs and EXPORTS them so
 * the geo/catalog/amenities modules pick up the real counts by importing this
 * module. CacheService, DrizzleClient and EventEmitter2 are @Global.
 */
const repositoryProvider: Provider = {
  provide: BUSINESSES_REPOSITORY,
  useClass: BusinessesRepository,
};

// One @Injectable class implements all three counter interfaces; bound to each
// token via useExisting so a single instance serves every consumer.
const counterProviders: Provider[] = [
  { provide: BUSINESS_COUNTER, useExisting: BusinessCounters },
  { provide: CATEGORY_BUSINESS_COUNTER, useExisting: BusinessCounters },
  { provide: AMENITY_USAGE_COUNTER, useExisting: BusinessCounters },
];

@Module({
  imports: [MediaModule],
  providers: [repositoryProvider, BusinessDomainService, BusinessCounters, ...counterProviders],
  exports: [
    BUSINESSES_REPOSITORY,
    BusinessDomainService,
    BUSINESS_COUNTER,
    CATEGORY_BUSINESS_COUNTER,
    AMENITY_USAGE_COUNTER,
  ],
})
export class BusinessModule {}
