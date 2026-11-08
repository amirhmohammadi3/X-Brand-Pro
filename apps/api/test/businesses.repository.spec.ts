import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { DrizzleClient, createPool, type DrizzleDb } from '../src/db/drizzle.client.js';
import { databaseAvailable, databaseReachableSync, prepareTestDatabase } from './db.js';
import { BusinessesRepository } from '../src/modules/business/businesses.repository.js';
import { BusinessCounters } from '../src/modules/business/businesses.counters.js';
import { MediaUrlService } from '../src/modules/media/media-url.service.js';
import { businesses } from '../src/db/schema/business.js';
import { amenities } from '../src/db/schema/catalog.js';
import { createBusiness, createCategory, createCity } from './factories/businesses.js';
import type { AppConfig } from '../src/config/env.js';

/**
 * BusinessesRepository integration (B2.4) — DB-requiring. Self-skips when
 * Postgres is unreachable (sandboxes without Docker); runs on a Docker machine
 * (`pnpm services:up`). Covers: insert + read round trip with location and
 * categories, the only-one-primary constraint, the three counter providers
 * (delete protections in B2.1–B2.3 now refuse when a business exists), the
 * partial indexes via `pg_indexes`, and the `avg_rating` + active-requires-
 * published CHECK constraints.
 */
describe.skipIf(!databaseReachableSync())('BusinessesRepository integration (B2.4)', () => {
  let db: DrizzleDb | null = null;
  let repo: BusinessesRepository | null = null;
  let counters: BusinessCounters | null = null;

  beforeAll(async () => {
    if (!(await databaseAvailable())) return;
    await prepareTestDatabase();
    const pool = createPool(process.env.TEST_DATABASE_URL ?? '');
    const client = new DrizzleClient(pool);
    db = client.db;
    const mediaUrl = new MediaUrlService({
      mediaPublicBase: 'http://localhost:4000/media',
    } as AppConfig);
    repo = new BusinessesRepository(client, mediaUrl);
    counters = new BusinessCounters(client);
  });

  it('inserts a business and reads it back with location, city and categories', async () => {
    if (!repo || !db) return;
    const city = await createCity(db);
    const cat = await createCategory(db);
    const inserted = await repo.insert({
      slug: 'round-trip-biz',
      name: 'کافه رحیمی',
      cityId: city.id,
      primaryCategoryId: cat.id,
      address: 'ولیعصر، پلاک ۱',
      location: { lat: 35.6892, lng: 51.389 },
      categoryIds: [cat.id],
      amenityIds: [],
    });
    expect(inserted.id).toBeTruthy();
    expect(inserted.name).toBe('کافه رحیمی');
    expect(inserted.location.lat).toBeCloseTo(35.6892, 3);
    expect(inserted.location.lng).toBeCloseTo(51.389, 3);
    expect(inserted.city.id).toBe(city.id);
    expect(inserted.primaryCategory.id).toBe(cat.id);
    expect(inserted.categories.length).toBe(1);
    const primary = inserted.categories.find((c) => c.isPrimary);
    expect(primary).toBeDefined();
    expect(primary?.id).toBe(cat.id);
    expect(inserted.status).toBe('pending');

    const bySlug = await repo.findBySlug('round-trip-biz');
    expect(bySlug?.id).toBe(inserted.id);
  });

  it('enforces exactly one primary category per business', async () => {
    if (!db) return;
    const biz = await createBusiness(db, { slug: 'one-primary-biz' });
    // The factory already inserted one is_primary=true row for this business.
    // A second is_primary=true row for the same business must be rejected by
    // the partial unique index `business_categories_one_primary`.
    await expect(
      db.execute(
        sql`insert into business_categories (business_id, category_id, is_primary)
            values (${biz.id}, ${biz.primaryCategoryId}, true)`,
      ),
    ).rejects.toThrow();
  });

  it('counters report businesses for city, category and amenity (delete protections trip)', async () => {
    if (!counters || !db) return;
    const biz = await createBusiness(db, { slug: 'counter-biz' });
    // amenity link
    const amenityRows = await db
      .insert(amenities)
      .values({
        slug: 'wifi-counter',
        name: { fa: 'وای‌فای', en: 'Wi-Fi' },
        icon: 'wifi',
        group: 'comfort',
        isActive: true,
        sortOrder: 0,
      })
      .returning();
    const amenity = amenityRows[0];
    if (!amenity) throw new Error('amenity insert returned no row');
    await db.execute(
      sql`insert into business_amenities (business_id, amenity_id) values (${biz.id}, ${amenity.id})`,
    );

    expect(await counters.countByCity(biz.cityId)).toBeGreaterThanOrEqual(1);
    expect(await counters.countByCategory(biz.primaryCategoryId)).toBeGreaterThanOrEqual(1);
    expect(await counters.countByAmenity(amenity.id)).toBeGreaterThanOrEqual(1);
    // an unrelated city/category/amenity reports 0
    const otherCity = await createCity(db, { slug: 'other-city' });
    const otherCat = await createCategory(db, { slug: 'other-cat' });
    expect(await counters.countByCity(otherCity.id)).toBe(0);
    expect(await counters.countByCategory(otherCat.id)).toBe(0);
  });

  it('soft-deleted businesses are excluded from the counters', async () => {
    if (!counters || !db) return;
    const biz = await createBusiness(db, { slug: 'softdel-biz' });
    expect(await counters.countByCity(biz.cityId)).toBeGreaterThanOrEqual(1);
    await db.execute(sql`update businesses set deleted_at = now() where id = ${biz.id}`);
    expect(await counters.countByCity(biz.cityId)).toBe(0);
  });

  it('creates the partial indexes (pg_indexes)', async () => {
    if (!db) return;
    const result = await db.execute(
      sql`select indexname from pg_indexes where tablename in ('businesses','business_categories')`,
    );
    const names = new Set((result.rows as { indexname: string }[]).map((r) => r.indexname));
    expect(names.has('businesses_active_city_rating_idx')).toBe(true);
    expect(names.has('business_categories_one_primary')).toBe(true);
    expect(names.has('businesses_location_idx')).toBe(true);
  });

  it('rejects avg_rating outside 0..5 (CHECK constraint)', async () => {
    if (!db) return;
    const city = await createCity(db, { slug: 'avg-city' });
    const cat = await createCategory(db, { slug: 'avg-cat' });
    await expect(
      db.execute(
        sql`insert into businesses (slug, name, city_id, primary_category_id, address, location, status, avg_rating)
            values ('bad-rating', 'x', ${city.id}, ${cat.id}, 'a',
                    ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography,
                    'pending', 6.00)`,
      ),
    ).rejects.toThrow();
  });

  it('rejects an active business without published_at (CHECK constraint)', async () => {
    if (!db) return;
    const city = await createCity(db, { slug: 'pub-city' });
    const cat = await createCategory(db, { slug: 'pub-cat' });
    await expect(
      db.execute(
        sql`insert into businesses (slug, name, city_id, primary_category_id, address, location, status, published_at)
            values ('no-publish', 'x', ${city.id}, ${cat.id}, 'a',
                    ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography,
                    'active', null)`,
      ),
    ).rejects.toThrow();
  });

  it('setStatus(active) stamps published_at automatically', async () => {
    if (!repo || !db) return;
    const biz = await createBusiness(db, { slug: 'setstatus-biz', status: 'pending' });
    await repo.setStatus(biz.id, 'active');
    const result = await db.execute(
      sql`select status, published_at from businesses where id = ${biz.id}`,
    );
    const row = (result.rows as { status: string; published_at: Date | null }[])[0];
    if (!row) throw new Error('business row not found');
    expect(row.status).toBe('active');
    expect(row.published_at).not.toBeNull();
  });

  it('softDelete sets deleted_at and hides the business from listByOwner', async () => {
    if (!repo || !db) return;
    const owner = crypto.randomUUID();
    await createBusiness(db, { slug: 'softlist-biz', ownerId: owner });
    expect((await repo.listByOwner(owner)).length).toBe(1);
    const bizRows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, 'softlist-biz'))
      .limit(1);
    const bizRow = bizRows[0];
    if (!bizRow) throw new Error('business row not found');
    await repo.softDelete(bizRow.id);
    expect((await repo.listByOwner(owner)).length).toBe(0);
  });
});
