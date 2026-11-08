import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from './categories.repository.js';
import {
  CATEGORY_BUSINESS_COUNTER,
  CategoriesService,
  type CategoryBusinessCounter,
} from './categories.service.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesAdminController } from './categories-admin.controller.js';

const repositoryProvider: Provider = {
  provide: CATEGORIES_REPOSITORY,
  useClass: CategoriesRepository,
};

/** Stub business counter: returns 0 until B2.4 registers the real one. */
const businessCounterStub: Provider = {
  provide: CATEGORY_BUSINESS_COUNTER,
  useValue: {
    countByCategory: async (_categoryId: string): Promise<number> => 0,
  } satisfies CategoryBusinessCounter,
};

/**
 * Catalog module (B2.2) — hierarchical business categories (two levels).
 * Public anonymous reads (cached tree) + admin CRUD (`catalog.manage`,
 * audited). `CATEGORY_BUSINESS_COUNTER` is an optional provider that B2.4
 * overrides with the real per-category business count; until then a stub
 * returns 0 so the delete guard never trips.
 *
 * CacheService, DrizzleClient and EventEmitter2 are @Global / globally
 * registered, so only AuditModule (AUDIT_SERVICE) needs importing here.
 */
@Module({
  imports: [AuditModule],
  controllers: [CategoriesController, CategoriesAdminController],
  providers: [repositoryProvider, businessCounterStub, CategoriesService],
  exports: [CategoriesService],
})
export class CatalogModule {}
