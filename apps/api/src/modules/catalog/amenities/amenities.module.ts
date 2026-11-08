import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { AMENITIES_REPOSITORY, AmenitiesRepository } from './amenities.repository.js';
import {
  AMENITY_USAGE_COUNTER,
  AmenitiesService,
  type AmenityUsageCounter,
} from './amenities.service.js';
import { AmenitiesController } from './amenities.controller.js';
import { AmenitiesAdminController } from './amenities-admin.controller.js';

const repositoryProvider: Provider = {
  provide: AMENITIES_REPOSITORY,
  useClass: AmenitiesRepository,
};

/** Stub usage counter: returns 0 until B2.4 registers the real one. */
const usageCounterStub: Provider = {
  provide: AMENITY_USAGE_COUNTER,
  useValue: {
    countByAmenity: async (_amenityId: string): Promise<number> => 0,
  } satisfies AmenityUsageCounter,
};

/**
 * Amenities module (B2.3) — features + a category↔amenity mapping. Public
 * cached reads + admin CRUD (`catalog.manage`, audited). `AMENITY_USAGE_COUNTER`
 * is an optional provider B2.4 overrides with the real business-usage count.
 */
@Module({
  imports: [AuditModule],
  controllers: [AmenitiesController, AmenitiesAdminController],
  providers: [repositoryProvider, usageCounterStub, AmenitiesService],
  exports: [AmenitiesService],
})
export class AmenitiesModule {}
