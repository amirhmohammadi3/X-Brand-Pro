import { Module, type Provider } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module.js';
import { BusinessModule } from '../../business/businesses.module.js';
import { CATEGORIES_REPOSITORY, CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesAdminController } from './categories-admin.controller.js';

const repositoryProvider: Provider = {
  provide: CATEGORIES_REPOSITORY,
  useClass: CategoriesRepository,
};

/**
 * Catalog module (B2.2) — hierarchical business categories (two levels).
 * Public anonymous reads (cached tree) + admin CRUD (`catalog.manage`,
 * audited). `CATEGORY_BUSINESS_COUNTER` is provided by BusinessModule (B2.4)
 * and resolves to the real per-category business count; the delete guard now
 * refuses when a category has businesses.
 *
 * CacheService, DrizzleClient and EventEmitter2 are @Global / globally
 * registered, so only AuditModule (AUDIT_SERVICE) plus BusinessModule
 * (CATEGORY_BUSINESS_COUNTER) need importing here.
 */
@Module({
  imports: [AuditModule, BusinessModule],
  controllers: [CategoriesController, CategoriesAdminController],
  providers: [repositoryProvider, CategoriesService],
  exports: [CategoriesService],
})
export class CatalogModule {}
