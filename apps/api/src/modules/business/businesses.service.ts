import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type BusinessDetail,
  type BusinessStatus,
  type BusinessSummary,
  type CreateBusinessBody,
  type UpdateBusinessBody,
  type BusinessTransitionBody,
} from '@app/contracts';
import { BUSINESSES_REPOSITORY, type BusinessesRepositoryLike } from './businesses.repository.js';
// Value import: Nest resolves BusinessDomainService by type via
// emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`). BusinessRuleError is constructed at runtime.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  BusinessDomainService,
  BusinessRuleError,
  type BusinessActorKind,
} from './businesses.domain.js';
import { canViewBusinessHours, type BusinessActor } from './business-access.js';
import { roleHasPermissions } from '../users/users.service.js';

/**
 * Business catalog CRUD service (B2.6) — the HTTP-layer orchestration over the
 * B2.4 repository + domain rules. Owns: registration (owner = the caller, status
 * `pending`, Persian slug derived from the name with collision suffixing),
 * visibility split (active is public; non-active visible only to its owner or a
 * `businesses.manage` holder, answering 404 to avoid leaking existence), the
 * status state machine transitions (who may move which status to which), and
 * soft delete (owners may remove never-published submissions; published ones
 * require an admin — owners close instead).
 *
 * Authorization reuses `business-access.ts` (B2.5, relaxed in B2.6 to match
 * owners by `ownerId` rather than the `owner` role tag) and the pure
 * `BusinessDomainService` (status machine, location-in-bbox, slug, contact
 * normalisation). Audit logging lives in the controller (B1.11 pattern).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses an owner may SOFT-DELETE their own business in (never published). */
const OWNER_DELETABLE_STATUSES: readonly BusinessStatus[] = ['draft', 'pending', 'rejected'];

function notFoundException(what: string, id: string): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND' as const,
    messageKey: 'errors.not_found',
    message: `${what} ${id} not found`,
    details: { entity: what.toLowerCase(), id },
  });
}

function forbiddenException(message: string): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN' as const,
    messageKey: 'errors.forbidden',
    message,
  });
}

/** Map a domain BusinessRuleError to the HTTP 422 envelope shape. */
function ruleException(err: BusinessRuleError): HttpException {
  return new HttpException(
    {
      code: 'UNPROCESSABLE' as const,
      messageKey: 'errors.unprocessable',
      message: err.message,
      details: err.details,
    },
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

@Injectable()
export class BusinessesService {
  constructor(
    @Inject(BUSINESSES_REPOSITORY) private readonly repo: BusinessesRepositoryLike,
    private readonly domain: BusinessDomainService,
  ) {}

  // ─── Create ──────────────────────────────────────────────────────────────

  /**
   * Register a business. The caller becomes its owner; the row starts `pending`
   * and `source = 'manual'`. Validates: city exists + active, location inside
   * the city bbox (else Iran's rough bbox), neighborhood belongs to the city,
   * primary + secondary categories exist + active, amenities exist + active.
   * The slug is derived from the name (Persian-aware `slugify`), falling back to
   * the city's Persian name, with `-2`, `-3`, … collision suffixing.
   */
  async createBusiness(actor: BusinessActor, body: CreateBusinessBody): Promise<BusinessDetail> {
    const city = await this.repo.findCityForBusiness(body.cityId);
    if (!city || !city.isActive) throw notFoundException('City', body.cityId);
    this.guardRule(() => this.domain.assertLocationInsideCityBbox(body.location, city.bbox));

    if (body.neighborhoodId) {
      const ok = await this.repo.findNeighborhoodInCity(body.neighborhoodId, body.cityId);
      if (!ok) throw notFoundException('Neighborhood', body.neighborhoodId);
    }

    const secondaryCategoryIds = body.categoryIds ?? [];
    const allCategoryIds = Array.from(new Set([body.primaryCategoryId, ...secondaryCategoryIds]));
    await this.assertCategoriesActive(allCategoryIds, body.primaryCategoryId);

    const amenityIds = body.amenityIds ?? [];
    if (amenityIds.length > 0) await this.assertAmenitiesActive(amenityIds);

    const cityName = city.name.fa ?? city.name.en ?? city.slug;
    const slug = await this.guardRuleAsync(() =>
      this.domain.generateUniqueSlug(body.name, cityName, (s) => this.repo.existsSlug(s)),
    );

    const contacts = this.domain.normalizeContacts({
      phone: body.phone ?? null,
      whatsapp: body.whatsapp ?? null,
      telegram: body.telegram ?? null,
      instagram: body.instagram ?? null,
      website: body.website ?? null,
      email: body.email ?? null,
    });

    return this.repo.insert({
      slug,
      name: body.name,
      nameAlt: body.nameAlt ?? null,
      description: body.description ?? null,
      cityId: body.cityId,
      neighborhoodId: body.neighborhoodId ?? null,
      primaryCategoryId: body.primaryCategoryId,
      address: body.address,
      location: body.location,
      priceLevel: body.priceLevel ?? null,
      phone: contacts.phone,
      whatsapp: contacts.whatsapp,
      telegram: contacts.telegram,
      instagram: contacts.instagram,
      website: contacts.website,
      email: contacts.email,
      tags: body.tags ?? [],
      ownerId: actor.id,
      createdBy: actor.id,
      status: 'pending',
      source: 'manual',
      categoryIds: allCategoryIds,
      amenityIds,
    });
  }

  // ─── Read ────────────────────────────────────────────────────────────────

  /** The caller's own businesses (every status; owner list is never paginated). */
  async listMyBusinesses(actor: BusinessActor): Promise<BusinessSummary[]> {
    return this.repo.listByOwner(actor.id);
  }

  /**
   * Public/owner detail by id or slug. Active businesses are public; a
   * non-active one is visible only to its owner (id match) or a
   * `businesses.manage` holder — every other caller (including anonymous) gets
   * 404 so existence is never leaked (the same rule B2.5's hours GET adopts).
   */
  async getBusinessDetail(
    actor: BusinessActor | undefined,
    idOrSlug: string,
  ): Promise<BusinessDetail> {
    const detail = UUID_RE.test(idOrSlug)
      ? await this.repo.findById(idOrSlug)
      : await this.repo.findBySlug(idOrSlug);
    if (!detail) throw notFoundException('Business', idOrSlug);
    if (detail.status === 'active') return detail;
    if (
      !canViewBusinessHours(actor ? { id: actor.id, role: actor.role } : undefined, {
        ownerId: detail.ownerId,
        status: detail.status,
      })
    ) {
      throw notFoundException('Business', idOrSlug);
    }
    return detail;
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  /**
   * Update scalar fields + replace the category/amenity join tables when their
   * ids are supplied. The owner may edit while in an owner-editable status or
   * `rejected` (fix-and-resubmit); an admin (`businesses.manage`) may edit any
   * status. The slug is derived once at create and never changed here (stable
   * public URLs). Re-validates city bbox / neighborhood / categories / amenities
   * only for the fields actually being changed.
   */
  async updateBusiness(
    actor: BusinessActor,
    id: string,
    body: UpdateBusinessBody,
  ): Promise<BusinessDetail> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Business', id);
    if (!this.canEditBusiness(actor, existing)) {
      throw forbiddenException('You may not edit this business in its current status.');
    }

    const cityId = body.cityId ?? existing.city.id;
    const location = body.location ?? existing.location;
    if (body.cityId !== undefined || body.location !== undefined) {
      const city = await this.repo.findCityForBusiness(cityId);
      if (!city || !city.isActive) throw notFoundException('City', cityId);
      this.guardRule(() => this.domain.assertLocationInsideCityBbox(location, city.bbox));
    }
    if (body.neighborhoodId) {
      const ok = await this.repo.findNeighborhoodInCity(body.neighborhoodId, cityId);
      if (!ok) throw notFoundException('Neighborhood', body.neighborhoodId);
    }

    const primaryCategoryId = body.primaryCategoryId ?? existing.primaryCategory.id;
    const secondaryCategoryIds =
      body.categoryIds ?? existing.categories.filter((c) => !c.isPrimary).map((c) => c.id);
    const allCategoryIds = Array.from(new Set([primaryCategoryId, ...secondaryCategoryIds]));
    const touchesCategories =
      body.categoryIds !== undefined || body.primaryCategoryId !== undefined;
    if (touchesCategories) {
      await this.assertCategoriesActive(allCategoryIds, primaryCategoryId);
    }

    const amenityIds = body.amenityIds ?? existing.amenities.map((a) => a.id);
    const touchesAmenities = body.amenityIds !== undefined;
    if (touchesAmenities && amenityIds.length > 0) {
      await this.assertAmenitiesActive(amenityIds);
    }

    const contacts =
      body.phone !== undefined ||
      body.whatsapp !== undefined ||
      body.telegram !== undefined ||
      body.instagram !== undefined ||
      body.website !== undefined ||
      body.email !== undefined
        ? this.domain.normalizeContacts({
            phone: body.phone ?? existing.phone,
            whatsapp: body.whatsapp ?? existing.whatsapp,
            telegram: body.telegram ?? existing.telegram,
            instagram: body.instagram ?? existing.instagram,
            website: body.website ?? existing.website,
            email: body.email ?? existing.email,
          })
        : null;

    const updated = await this.repo.update(id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.nameAlt !== undefined ? { nameAlt: body.nameAlt } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.cityId !== undefined ? { cityId } : {}),
      ...(body.neighborhoodId !== undefined ? { neighborhoodId: body.neighborhoodId } : {}),
      ...(body.primaryCategoryId !== undefined ? { primaryCategoryId } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.location !== undefined ? { location } : {}),
      ...(body.priceLevel !== undefined ? { priceLevel: body.priceLevel } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(contacts
        ? {
            phone: contacts.phone,
            whatsapp: contacts.whatsapp,
            telegram: contacts.telegram,
            instagram: contacts.instagram,
            website: contacts.website,
            email: contacts.email,
          }
        : {}),
    });
    if (!updated) throw notFoundException('Business', id);

    if (touchesCategories) {
      await this.repo.replaceCategories(id, secondaryCategoryIds, primaryCategoryId);
    }
    if (touchesAmenities) {
      await this.repo.replaceAmenities(id, amenityIds);
    }

    const refreshed = await this.repo.findById(id);
    if (!refreshed) throw notFoundException('Business', id);
    return refreshed;
  }

  // ─── Status transition ───────────────────────────────────────────────────

  /**
   * Move a business along the status state machine (see TRANSITIONS in
   * businesses.domain.ts). The actor is an `owner` (by id match) or an `admin`
   * (by `businesses.manage`); an actor who is BOTH may use either path, so an
   * admin who owns a business can still perform owner-only transitions (e.g.
   * submit a draft) on it. Returns the updated detail and the previous status
   * (the controller logs the before→after for the moderation audit trail).
   *
   * `rejected` requires a reason (the body schema enforces presence); going
   * `active` stamps `published_at` (the repository does it in `setStatus`).
   */
  async transitionBusiness(
    actor: BusinessActor,
    id: string,
    body: BusinessTransitionBody,
  ): Promise<{ business: BusinessDetail; previousStatus: BusinessStatus }> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Business', id);

    const isOwner = existing.ownerId === actor.id;
    const isAdmin = roleHasPermissions(actor.role as never, ['businesses.manage']);
    if (!isOwner && !isAdmin) {
      throw forbiddenException('Only the owner or a moderator may change this business.');
    }

    const from = existing.status;
    const to = body.status;
    const allowedViaOwner = isOwner && this.domain.canTransition(from, to, 'owner');
    const allowedViaAdmin = isAdmin && this.domain.canTransition(from, to, 'admin');
    if (!allowedViaOwner && !allowedViaAdmin) {
      throw ruleException(
        new BusinessRuleError(`status may not move from ${from} to ${to}`, {
          from,
          to,
          field: 'status',
        }),
      );
    }

    if (to === 'rejected') {
      await this.repo.update(id, { rejectionReason: body.rejectionReason ?? null });
    } else if (from === 'rejected' && to === 'pending') {
      // Resubmission clears the prior rejection reason.
      await this.repo.update(id, { rejectionReason: null });
    }
    await this.repo.setStatus(id, to);

    const refreshed = await this.repo.findById(id);
    if (!refreshed) throw notFoundException('Business', id);
    return { business: refreshed, previousStatus: from };
  }

  // ─── Soft delete ─────────────────────────────────────────────────────────

  /**
   * Soft-delete (`deleted_at`): owners may remove only never-published
   * submissions (`draft`, `pending`, `rejected`); a published business
   * (`active`, `suspended`, `closed`) requires an admin — owners should close it
   * instead (the `active → closed` transition). Soft-deleted rows stay for
   * audit/SEO redirect and drop out of every list/counter.
   */
  async deleteBusiness(actor: BusinessActor, id: string): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) throw notFoundException('Business', id);
    const isOwner = existing.ownerId === actor.id;
    const isAdmin = roleHasPermissions(actor.role as never, ['businesses.manage']);
    if (!(isAdmin || (isOwner && OWNER_DELETABLE_STATUSES.includes(existing.status)))) {
      throw forbiddenException('Only an admin may delete a published business; close it instead.');
    }
    await this.repo.softDelete(id);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  /** Owner-editable statuses for PATCH: B2.5's set plus `rejected` (fix-and-resubmit). */
  private canEditBusiness(
    actor: BusinessActor,
    business: {
      ownerId: string | null;
      status: BusinessStatus;
    },
  ): boolean {
    if (roleHasPermissions(actor.role as never, ['businesses.manage'])) return true;
    if (business.ownerId !== actor.id) return false;
    return (
      business.status === 'draft' ||
      business.status === 'pending' ||
      business.status === 'active' ||
      business.status === 'suspended' ||
      business.status === 'rejected'
    );
  }

  /** Throw NOT_FOUND for any category in `ids` that is missing/inactive; the
   * primary must always be active (a business cannot be filed under a hidden
   * category). `ids` already includes the primary. */
  private async assertCategoriesActive(ids: string[], primaryCategoryId: string): Promise<void> {
    if (ids.length === 0) return;
    const active = new Set(await this.repo.categoriesExistAndActive(ids));
    if (!active.has(primaryCategoryId)) throw notFoundException('Category', primaryCategoryId);
    for (const cid of ids) {
      if (!active.has(cid)) throw notFoundException('Category', cid);
    }
  }

  private async assertAmenitiesActive(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const active = new Set(await this.repo.amenitiesExistAndActive(ids));
    for (const aid of ids) {
      if (!active.has(aid)) throw notFoundException('Amenity', aid);
    }
  }

  private guardRule<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof BusinessRuleError) throw ruleException(err);
      throw err;
    }
  }

  private async guardRuleAsync<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BusinessRuleError) throw ruleException(err);
      throw err;
    }
  }
}

// Re-export the actor-kind type so callers that need to reason about transitions
// import it from the service module alongside the access helpers.
export type { BusinessActorKind };
