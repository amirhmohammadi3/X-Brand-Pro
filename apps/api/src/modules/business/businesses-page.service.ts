import { Injectable } from '@nestjs/common';
import type { BusinessPage, BusinessPageQuery } from '@app/contracts';
// Value imports: Nest reads constructor parameter types at runtime via
// emitDecoratorMetadata — type-only would break DI (B1.3).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BusinessesService } from './businesses.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { HoursService } from './hours/hours.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PhotosService } from './photos/photos.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { MenuService } from './menu/menu.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReviewsService } from '../reviews/reviews.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QaService } from '../qa/qa.service.js';
import { buildBusinessJsonLd } from './businesses-jsonld.js';
import type { BusinessActor } from './business-access.js';

/**
 * B4.9 — the business-page aggregate (the ONE read F4.1's server render
 * needs for first paint). Composition ONLY: every fact comes from a service
 * that already backs its own public endpoint — the visibility gate is
 * `BusinessesService.getBusinessDetail`'s (active for guests; non-active
 * visible only to the owner / a `businesses.manage` holder, 404 otherwise —
 * existence is never leaked), the reviews are approved-only via
 * `ReviewsService.listByBusiness`, the Q&A count via `QaService.listByBusiness`
 * (a pageSize=1 probe — only `meta.total` is needed).
 *
 * Nothing is cached here yet: every underlying read is indexed and the
 * F4.1 page is server-rendered per request; a Redis cache keyed by
 * businessId + updatedAt burst is a follow-up when the traffic numbers
 * justify it (AGENTS.md: side effects async, reads honest).
 */
@Injectable()
export class BusinessPageService {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly hours: HoursService,
    private readonly photos: PhotosService,
    private readonly menu: MenuService,
    private readonly reviews: ReviewsService,
    private readonly qa: QaService,
  ) {}

  async getPage(
    idOrSlug: string,
    actor: BusinessActor | undefined,
    query: BusinessPageQuery,
  ): Promise<BusinessPage> {
    // The gate: 404 for a missing/soft-deleted/non-visible business, the
    // detail for everything else (id OR slug — stable public URLs).
    const detail = await this.businesses.getBusinessDetail(actor, idOrSlug);
    // The city's IANA timezone drives the open-now computation (B2.5) —
    // the same context the GET /hours endpoint resolves.
    const ctx = await this.hours.getBusinessContext(detail.id);
    const [hoursResponse, photos, menuResponse, reviews, questions] = await Promise.all([
      this.hours.getHoursResponse(detail.id, ctx.timezone),
      this.photos.list(detail.id),
      this.menu.getMenu(detail.id),
      this.reviews.listByBusiness(detail.id, { page: query.page, pageSize: query.pageSize }),
      // One-row probe: only meta.total (the approved question count) is used.
      this.qa.listByBusiness(detail.id, { page: 1, pageSize: 1 }),
    ]);
    return {
      business: detail,
      hours: hoursResponse,
      photos,
      menu: menuResponse,
      reviews: { items: reviews.items, meta: reviews.meta },
      questions: { total: questions.meta.total },
      jsonLd: buildBusinessJsonLd({ detail, photos, hours: hoursResponse }),
    };
  }
}
