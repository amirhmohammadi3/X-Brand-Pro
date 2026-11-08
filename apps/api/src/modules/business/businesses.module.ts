import { Module, type Provider } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { BUSINESSES_REPOSITORY, BusinessesRepository } from './businesses.repository.js';
import { BusinessDomainService } from './businesses.domain.js';
import { BusinessCounters } from './businesses.counters.js';
import { BUSINESS_COUNTER } from '../geo/geo.service.js';
import { CATEGORY_BUSINESS_COUNTER } from '../catalog/categories/categories.service.js';
import { AMENITY_USAGE_COUNTER } from '../catalog/amenities/amenities.service.js';
import { HOURS_REPOSITORY, HoursRepository } from './hours/hours.repository.js';
import { HoursService } from './hours/hours.service.js';
import { HoursController } from './hours/hours.controller.js';

/**
 * Business catalog module (B2.4 + B2.5) — the core business data model: schema,
 * repository and domain rules (status state machine, location-in-bbox, slug,
 * contact normalisers), plus the opening-hours sub-module (B2.5): weekly
 * schedule, special days, and the pure `computeOpenStatus` "open now" logic.
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

const hoursRepositoryProvider: Provider = {
  provide: HOURS_REPOSITORY,
  useClass: HoursRepository,
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
  controllers: [HoursController],
  providers: [
    repositoryProvider,
    hoursRepositoryProvider,
    BusinessDomainService,
    BusinessCounters,
    HoursService,
    ...counterProviders,
  ],
  exports: [
    BUSINESSES_REPOSITORY,
    BusinessDomainService,
    BUSINESS_COUNTER,
    CATEGORY_BUSINESS_COUNTER,
    AMENITY_USAGE_COUNTER,
  ],
})
export class BusinessModule {}
