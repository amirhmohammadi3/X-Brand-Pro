import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { BusinessDetail, BusinessStatus, BusinessSummary, GeoPoint } from '@app/contracts';
import { BusinessesService } from '../src/modules/business/businesses.service.js';
import { BusinessDomainService } from '../src/modules/business/businesses.domain.js';
import type {
  BusinessesRepositoryLike,
  CityForBusiness,
  CreateBusinessInput,
  UpdateBusinessInput,
} from '../src/modules/business/businesses.repository.js';

/**
 * BusinessesService unit tests (B2.6) — the HTTP-layer orchestration exercised
 * without a database via a hand-written fake repository. Covers registration
 * (owner = caller, status `pending`, Persian slug + collision suffix, city bbox
 * + category/amenity validation), the public/owner detail visibility split, the
 * status state machine (owner vs admin actor paths, invalid transitions), and
 * the soft-delete rules (owner may remove never-published only; admin any).
 *
 * DB-requiring behaviour (the actual PostGIS/Drizzle queries, the
 * `published_at` CHECK) is covered by businesses.repository.spec.ts (B2.4).
 */

const CITY_ID = randomUUID();
const CAT_ID = randomUUID();
const CAT_ID_2 = randomUUID();
const AMEN_ID = randomUUID();
const OWNER_ID = randomUUID();
const ADMIN_ID = randomUUID();
const OTHER_ID = randomUUID();

const CITY: CityForBusiness = {
  id: CITY_ID,
  slug: 'tehran',
  name: { fa: 'تهران', en: 'Tehran' },
  bbox: { west: 51.0, south: 35.55, east: 51.6, north: 35.85 },
  isActive: true,
};

interface FakeOpts {
  city?: CityForBusiness | null;
  neighborhoodOk?: boolean;
  activeCategories?: Set<string>;
  activeAmenities?: Set<string>;
}

function makeFakeRepo(opts: FakeOpts = {}): BusinessesRepositoryLike & {
  store: Map<string, BusinessDetail>;
} {
  const store = new Map<string, BusinessDetail>();
  const slugIndex = new Map<string, string>();
  const activeCategories = opts.activeCategories ?? new Set([CAT_ID, CAT_ID_2]);
  const activeAmenities = opts.activeAmenities ?? new Set([AMEN_ID]);

  const buildDetail = (input: CreateBusinessInput, id: string): BusinessDetail => ({
    id,
    slug: input.slug,
    name: input.name,
    nameAlt: input.nameAlt ?? null,
    ownerId: input.ownerId ?? null,
    primaryCategory: { id: input.primaryCategoryId, slug: 'cat', name: { fa: 'کافه' } },
    city: { id: input.cityId, slug: CITY.slug, name: CITY.name },
    neighborhood: input.neighborhoodId
      ? { id: input.neighborhoodId, slug: 'neigh', name: { fa: 'ولیعصر' } }
      : null,
    address: input.address,
    location: input.location,
    priceLevel: input.priceLevel ?? null,
    avgRating: 0,
    reviewCount: 0,
    coverUrl: null,
    thumbUrl: null,
    isFeatured: input.isFeatured ?? false,
    isClaimed: input.isClaimed ?? false,
    description: input.description ?? null,
    phone: input.phone ?? null,
    whatsapp: input.whatsapp ?? null,
    telegram: input.telegram ?? null,
    instagram: input.instagram ?? null,
    website: input.website ?? null,
    email: input.email ?? null,
    amenities: (input.amenityIds ?? []).map((aid) => ({
      id: aid,
      slug: 'amen',
      name: { fa: 'وای‌فای' },
      icon: 'wifi',
    })),
    categories: Array.from(new Set([...(input.categoryIds ?? []), input.primaryCategoryId])).map(
      (cid) => ({
        id: cid,
        slug: 'cat',
        name: { fa: 'کافه' },
        isPrimary: cid === input.primaryCategoryId,
      }),
    ),
    tags: input.tags ?? [],
    status: input.status ?? 'pending',
    source: input.source ?? 'manual',
    rejectionReason: input.rejectionReason ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    store,
    async existsSlug(slug: string) {
      return slugIndex.has(slug);
    },
    async findById(id: string) {
      return store.get(id) ?? null;
    },
    async findBySlug(slug: string) {
      const id = slugIndex.get(slug);
      return id ? (store.get(id) ?? null) : null;
    },
    async insert(input: CreateBusinessInput) {
      const id = randomUUID();
      const detail = buildDetail(input, id);
      store.set(id, detail);
      slugIndex.set(detail.slug, id);
      return detail;
    },
    async update(id: string, input: UpdateBusinessInput) {
      const existing = store.get(id);
      if (!existing) return null;
      const merged: BusinessDetail = {
        ...existing,
        ...('name' in input && input.name !== undefined ? { name: input.name } : {}),
        ...('status' in input && input.status !== undefined ? { status: input.status } : {}),
        ...('rejectionReason' in input && input.rejectionReason !== undefined
          ? { rejectionReason: input.rejectionReason }
          : {}),
        ...('phone' in input && input.phone !== undefined ? { phone: input.phone } : {}),
        updatedAt: new Date().toISOString(),
      };
      store.set(id, merged);
      return merged;
    },
    async replaceCategories() {},
    async replaceAmenities() {},
    async setStatus(id: string, status: BusinessStatus) {
      const existing = store.get(id);
      if (!existing) return;
      store.set(id, {
        ...existing,
        status,
        ...(status === 'active' ? { rejectionReason: null } : {}),
        updatedAt: new Date().toISOString(),
      });
    },
    async softDelete(id: string) {
      store.delete(id);
      for (const [slug, bid] of slugIndex) if (bid === id) slugIndex.delete(slug);
    },
    async listByOwner(ownerId: string) {
      return [...store.values()].filter((b) => b.ownerId === ownerId) as BusinessSummary[];
    },
    async findCityForBusiness() {
      return opts.city === undefined ? CITY : opts.city;
    },
    async findNeighborhoodInCity() {
      return opts.neighborhoodOk ?? true;
    },
    async categoriesExistAndActive(ids: string[]) {
      return ids.filter((id) => activeCategories.has(id));
    },
    async amenitiesExistAndActive(ids: string[]) {
      return ids.filter((id) => activeAmenities.has(id));
    },
  };
}

function makeService(opts: FakeOpts = {}) {
  const repo = makeFakeRepo(opts);
  const service = new BusinessesService(repo, new BusinessDomainService());
  return { service, repo };
}

const VALID_BODY = {
  name: 'کافه رحیمی',
  cityId: CITY_ID,
  primaryCategoryId: CAT_ID,
  categoryIds: [CAT_ID_2],
  amenityIds: [AMEN_ID],
  address: 'ولیعصر، پلاک ۱',
  location: { lat: 35.6892, lng: 51.389 } as GeoPoint,
};

const owner = { id: OWNER_ID, role: 'user' };
const admin = { id: ADMIN_ID, role: 'admin' };

describe('BusinessesService.createBusiness (B2.6)', () => {
  it('registers a business as pending, owned by the caller, with a derived slug', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    expect(biz.status).toBe('pending');
    expect(biz.ownerId).toBe(OWNER_ID);
    expect(biz.slug).toBeTruthy();
    expect(biz.slug.length).toBeGreaterThan(0);
    expect(biz.categories.length).toBe(2); // primary + secondary merged
    expect(biz.categories.find((c) => c.isPrimary)?.id).toBe(CAT_ID);
  });

  it('appends a -2 suffix when the derived slug already exists', async () => {
    const { service, repo } = makeService();
    const first = await service.createBusiness(owner, VALID_BODY);
    // Force the same slug to look "taken" for the next insert.
    vi.spyOn(repo, 'existsSlug').mockImplementation(async (slug) => slug === first.slug);
    const second = await service.createBusiness(owner, { ...VALID_BODY, name: first.name });
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(first.slug)).toBe(true);
  });

  it('throws 404 when the city does not exist', async () => {
    const { service } = makeService({ city: null });
    await expect(service.createBusiness(owner, VALID_BODY)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 404 when the city is inactive', async () => {
    const { service } = makeService({ city: { ...CITY, isActive: false } });
    await expect(service.createBusiness(owner, VALID_BODY)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 422 when the location is outside the city bbox', async () => {
    const { service } = makeService();
    await expect(
      service.createBusiness(owner, {
        ...VALID_BODY,
        location: { lat: 10, lng: 10 } as GeoPoint,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });

  it('throws 404 when the primary category is inactive', async () => {
    const { service } = makeService({ activeCategories: new Set([CAT_ID_2]) });
    await expect(service.createBusiness(owner, VALID_BODY)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('throws 404 when an amenity is inactive', async () => {
    const { service } = makeService({ activeAmenities: new Set() });
    await expect(service.createBusiness(owner, VALID_BODY)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });
});

describe('BusinessesService.getBusinessDetail (B2.6)', () => {
  it('returns an active business to an anonymous caller', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await repo.setStatus(biz.id, 'active');
    const got = await service.getBusinessDetail(undefined, biz.id);
    expect(got.id).toBe(biz.id);
  });

  it('answers 404 (not 403) for a non-active business to an anonymous caller', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY); // pending
    await expect(service.getBusinessDetail(undefined, biz.id)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('returns a non-active business to its owner', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    const got = await service.getBusinessDetail(owner, biz.id);
    expect(got.id).toBe(biz.id);
  });

  it('answers 404 for a non-active business to a different user', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await expect(
      service.getBusinessDetail({ id: OTHER_ID, role: 'user' }, biz.id),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('resolves by slug', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await repo.setStatus(biz.id, 'active');
    const got = await service.getBusinessDetail(undefined, biz.slug);
    expect(got.id).toBe(biz.id);
  });
});

describe('BusinessesService.transitionBusiness (B2.6)', () => {
  it('lets an admin approve a pending business (pending → active)', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    const { business, previousStatus } = await service.transitionBusiness(admin, biz.id, {
      status: 'active',
    });
    expect(previousStatus).toBe('pending');
    expect(business.status).toBe('active');
    expect(repo.store.get(biz.id)?.status).toBe('active');
  });

  it('blocks the owner from approving (pending → active is admin-only)', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await expect(
      service.transitionBusiness(owner, biz.id, { status: 'active' }),
    ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });

  it('lets an admin reject with a reason and stores it', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    const { business } = await service.transitionBusiness(admin, biz.id, {
      status: 'rejected',
      rejectionReason: 'محتوای نادرست',
    });
    expect(business.status).toBe('rejected');
    expect(repo.store.get(biz.id)?.rejectionReason).toBe('محتوای نادرست');
  });

  it('rejects an invalid transition with 422', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await expect(
      service.transitionBusiness(admin, biz.id, { status: 'closed' }),
    ).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
  });

  it('blocks a non-owner non-admin caller with 403', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await expect(
      service.transitionBusiness({ id: OTHER_ID, role: 'user' }, biz.id, { status: 'active' }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });
});

describe('BusinessesService.deleteBusiness (B2.6)', () => {
  it('lets the owner delete a never-published (pending) business', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await service.deleteBusiness(owner, biz.id);
    expect(repo.store.has(biz.id)).toBe(false);
  });

  it('blocks the owner from deleting an active business', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await repo.setStatus(biz.id, 'active');
    await expect(service.deleteBusiness(owner, biz.id)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('lets an admin delete an active business', async () => {
    const { service, repo } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await repo.setStatus(biz.id, 'active');
    await service.deleteBusiness(admin, biz.id);
    expect(repo.store.has(biz.id)).toBe(false);
  });
});

describe('BusinessesService.updateBusiness (B2.6)', () => {
  it('lets the owner edit a pending business', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    const updated = await service.updateBusiness(owner, biz.id, { name: 'کافه نو' });
    expect(updated.name).toBe('کافه نو');
  });

  it('blocks a different user from editing', async () => {
    const { service } = makeService();
    const biz = await service.createBusiness(owner, VALID_BODY);
    await expect(
      service.updateBusiness({ id: OTHER_ID, role: 'user' }, biz.id, { name: 'x' }),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('re-validates category activeness on update', async () => {
    const { service, repo } = makeService(); // both categories active at create
    const biz = await service.createBusiness(owner, VALID_BODY);
    // Simulate CAT_ID_2 becoming inactive before the update lands.
    vi.spyOn(repo, 'categoriesExistAndActive').mockImplementation(async (ids) =>
      ids.filter((id) => id === CAT_ID),
    );
    await expect(
      service.updateBusiness(owner, biz.id, { categoryIds: [CAT_ID_2] }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });
});
