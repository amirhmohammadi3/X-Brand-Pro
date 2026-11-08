import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { BusinessModule } from '../../business/businesses.module.js';
import { AMENITIES_REPOSITORY, AmenitiesRepository } from './amenities.repository.js';
import { AmenitiesService } from './amenities.service.js';
import { AmenitiesController } from './amenities.controller.js';
import { AmenitiesAdminController } from './amenities-admin.controller.js';

const repositoryProvider: Provider = {
  provide: AMENITIES_REPOSITORY,
  useClass: AmenitiesRepository,
};

/**
 * Amenities module (B2.3) — features + a category↔amenity mapping. Public
 * cached reads + admin CRUD (`catalog.manage`, audited). `AMENITY_USAGE_COUNTER`
 * is provided by BusinessModule (B2.4) and resolves to the real business-usage
 * count; the delete guard now refuses when an amenity is used by businesses.
 */
@Module({
  imports: [AuditModule, BusinessModule],
  controllers: [AmenitiesController, AmenitiesAdminController],
  providers: [repositoryProvider, AmenitiesService],
  exports: [AmenitiesService],
})
export class AmenitiesModule {}
