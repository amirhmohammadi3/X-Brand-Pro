import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
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
import {
  BUSINESS_PHOTOS_REPOSITORY,
  BusinessPhotosRepository,
} from './photos/business-photos.repository.js';
import { PhotosService } from './photos/photos.service.js';
import { PhotosController } from './photos/photos.controller.js';
import { MENU_REPOSITORY, MenuRepository } from './menu/menu.repository.js';
import { MenuService } from './menu/menu.service.js';
import { MenuController } from './menu/menu.controller.js';
import { CLAIMS_REPOSITORY, ClaimsRepository } from './claims/claims.repository.js';
import { ClaimsService } from './claims/claims.service.js';
import { ClaimsController } from './claims/claims.controller.js';
import { BusinessesService } from './businesses.service.js';
import { BusinessesController } from './businesses.controller.js';

/**
 * Business catalog module (B2.4–B2.9) — the core business data model:
 * schema, repository and domain rules (status state machine, location-in-bbox,
 * slug, contact normalisers); the opening-hours sub-module (B2.5); the CRUD
 * HTTP layer (B2.6): registration (owner = caller, status `pending`, Persian
 * slug), owner list, public/owner detail, update, status transitions and soft
 * delete — each write audited via AuditModule's AUDIT_SERVICE; the photo
 * gallery (B2.7, photos/); the menu / services (B2.8, menu/); and the ownership claims (B2.9, claims/).
 *
 * Binds the three counter providers (`BUSINESS_COUNTER`,
 * `CATEGORY_BUSINESS_COUNTER`, `AMENITY_USAGE_COUNTER`) that B2.1–B2.3 declared
 * as stubs and EXPORTS them so the geo/catalog/amenities modules pick up the real
 * counts by importing this module. CacheService, DrizzleClient and
 * EventEmitter2 are @Global. AuditModule is imported (not @Global) so the
 * controller can inject AUDIT_SERVICE; it does not import BusinessModule, so
 * there is no circular dependency.
 */
const repositoryProvider: Provider = {
  provide: BUSINESSES_REPOSITORY,
  useClass: BusinessesRepository,
};

const hoursRepositoryProvider: Provider = {
  provide: HOURS_REPOSITORY,
  useClass: HoursRepository,
};

const photosRepositoryProvider: Provider = {
  provide: BUSINESS_PHOTOS_REPOSITORY,
  useClass: BusinessPhotosRepository,
};

const menuRepositoryProvider: Provider = {
  provide: MENU_REPOSITORY,
  useClass: MenuRepository,
};

const claimsRepositoryProvider: Provider = {
  provide: CLAIMS_REPOSITORY,
  useClass: ClaimsRepository,
};

// One @Injectable class implements all three counter interfaces; bound to each
// token via useExisting so a single instance serves every consumer.
const counterProviders: Provider[] = [
  { provide: BUSINESS_COUNTER, useExisting: BusinessCounters },
  { provide: CATEGORY_BUSINESS_COUNTER, useExisting: BusinessCounters },
  { provide: AMENITY_USAGE_COUNTER, useExisting: BusinessCounters },
];

@Module({
  imports: [AuditModule, MediaModule],
  controllers: [
    BusinessesController,
    HoursController,
    PhotosController,
    MenuController,
    ClaimsController,
  ],
  providers: [
    repositoryProvider,
    hoursRepositoryProvider,
    photosRepositoryProvider,
    menuRepositoryProvider,
    claimsRepositoryProvider,
    BusinessDomainService,
    BusinessCounters,
    BusinessesService,
    HoursService,
    PhotosService,
    MenuService,
    ClaimsService,
    ...counterProviders,
  ],
  exports: [
    BUSINESSES_REPOSITORY,
    BusinessDomainService,
    BusinessesService,
    BUSINESS_COUNTER,
    CATEGORY_BUSINESS_COUNTER,
    AMENITY_USAGE_COUNTER,
  ],
})
export class BusinessModule {}
