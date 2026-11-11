import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BusinessModule } from '../business/businesses.module.js';
import { FAVORITES_REPOSITORY, FavoritesRepository } from './favorites.repository.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

/**
 * Favorites and named lists (B5.1): the storage model (one default list per
 * user + named lists; one list per (user, business)), the heart check, the
 * add/move/remove item flows and the list CRUD — every write audited.
 *
 * BusinessModule supplies BUSINESSES_REPOSITORY (the B2.4 summary cards for
 * the list-item read) — importing it creates no cycle: BusinessModule
 * imports Reviews/Qa/Audit/Media only. EventEmitter2 is @Global; AuditModule
 * is imported (not @Global) so the controller can inject AUDIT_SERVICE.
 */
@Module({
  imports: [BusinessModule, AuditModule],
  controllers: [FavoritesController],
  providers: [{ provide: FAVORITES_REPOSITORY, useClass: FavoritesRepository }, FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
