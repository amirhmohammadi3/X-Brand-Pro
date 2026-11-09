import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DrizzleClient, createPool, type DrizzleDb } from '../src/db/drizzle.client.js';
import { databaseAvailable, databaseReachableSync, prepareTestDatabase } from './db.js';
import { MapRepository } from '../src/modules/map/map.repository.js';
import { businesses } from '../src/db/schema/business.js';
import { createBusiness, createCategory, createCity } from './factories/businesses.js';

/**
 * MapRepository integration (B3.4) — DB-requiring (Postgres+PostGIS).
 * Self-skips when the database is unreachable (sandboxes without Docker);
 * runs on a Docker machine (`pnpm services:up`). Covers: the bbox count, the
 * two-part bbox predicate (GiST `&&` prefilter + exact `ST_Within`) excluding
 * points outside the viewport and inactive/soft-deleted rows, the grid
 * clustering (`ST_SnapToGrid` cells anchored at member centroids), the
 * points mode ordering + cap, and the city scoping.
 */
describe.skipIf(!databaseReachableSync())('MapRepository integration (B3.4)', () => {
  let db: DrizzleDb | null = null;
  let repo: MapRepository | null = null;

  const bbox = { west: 51.0, south: 35.5, east: 51.8, north: 36.0 };

  beforeAll(async () => {
    if (!(await databaseAvailable())) return;
    await prepareTestDatabase();
    const pool = createPool(process.env.TEST_DATABASE_URL ?? '');
    const client = new DrizzleClient(pool);
    db = client.db;
    repo = new MapRepository(client);
  });

  it('counts only active businesses inside the bbox', async () => {
    if (!repo || !db) return;
    const city = await createCity(db);
    const cat = await createCategory(db);
    await createBusiness(db, {
      cityId: city.id,
      primaryCategoryId: cat.id,
      status: 'active',
      location: { lat: 35.7, lng: 51.4 },
    });
    await createBusiness(db, {
      cityId: city.id,
      primaryCategoryId: cat.id,
      status: 'active',
      location: { lat: 35.72, lng: 51.42 },
    });
    // outside the bbox
    await createBusiness(db, {
      cityId: city.id,
      primaryCategoryId: cat.id,
      status: 'active',
      location: { lat: 36.5, lng: 52.5 },
    });
    // inside but pending → excluded
    await createBusiness(db, {
      cityId: city.id,
      primaryCategoryId: cat.id,
      status: 'pending',
      location: { lat: 35.74, lng: 51.44 },
    });
    const total = await repo.countInBbox(bbox);
    expect(total).toBe(2);
  });

  it('clusters by grid cell and anchors clusters at member centroids', async () => {
    if (!repo || !db) return;
    // Two points ~0.02° apart fall into one cell at cellDeg=0.1.
    await createBusiness(db, {
      status: 'active',
      location: { lat: 35.7, lng: 51.4 },
    });
    await createBusiness(db, {
      status: 'active',
      location: { lat: 35.72, lng: 51.42 },
    });
    // A far point in its own cell.
    await createBusiness(db, {
      status: 'active',
      location: { lat: 35.95, lng: 51.75 },
    });
    const clusters = await repo.findClusters({
      bbox,
      zoom: 4,
      mode: 'clusters',
      cellDeg: 0.1,
      pointLimit: 1000,
    });
    expect(clusters).toHaveLength(2);
    const byCount = [...clusters].sort((a, b) => b.count - a.count);
    expect(byCount[0]?.count).toBe(2);
    // centroid of (35.70,51.40)+(35.72,51.42)
    expect(byCount[0]?.location.lat).toBeCloseTo(35.71, 5);
    expect(byCount[0]?.location.lng).toBeCloseTo(51.41, 5);
    expect(byCount[1]?.count).toBe(1);
  });

  it('points mode returns points ordered by rating desc with the stable id tiebreaker', async () => {
    if (!repo || !db) return;
    const low = await createBusiness(db, {
      status: 'active',
      location: { lat: 35.7, lng: 51.4 },
    });
    await db
      .update(businesses)
      .set({ avgRating: '4.90', reviewCount: 3 })
      .where(eq(businesses.id, low.id));
    const high = await createBusiness(db, {
      status: 'active',
      location: { lat: 35.72, lng: 51.42 },
    });
    await db
      .update(businesses)
      .set({ avgRating: '4.20', reviewCount: 9 })
      .where(eq(businesses.id, high.id));
    const points = await repo.findPoints({
      bbox,
      zoom: 16,
      mode: 'points',
      cellDeg: 0,
      pointLimit: 1000,
    });
    expect(points.length).toBeGreaterThanOrEqual(2);
    const ours = points.filter((p) => p.id === low.id || p.id === high.id);
    expect(ours).toHaveLength(2);
    expect(ours[0]?.id).toBe(low.id); // 4.90 > 4.20
    expect(ours[0]?.avgRating).toBeCloseTo(4.9, 5);
    expect(ours[1]?.avgRating).toBeCloseTo(4.2, 5);
    expect(ours[0]?.primaryCategorySlug).toBeTruthy();
  });

  it('points mode honors the pointLimit cap', async () => {
    if (!repo || !db) return;
    const points = await repo.findPoints({
      bbox,
      zoom: 16,
      mode: 'points',
      cellDeg: 0,
      pointLimit: 2,
    });
    expect(points).toHaveLength(2);
  });

  it('cityId scopes the result to one city', async () => {
    if (!repo || !db) return;
    const cityA = await createCity(db, { slug: `map-city-a-${Date.now().toString(36)}` });
    const cat = await createCategory(db);
    await createBusiness(db, {
      cityId: cityA.id,
      primaryCategoryId: cat.id,
      status: 'active',
      location: { lat: 35.7, lng: 51.4 },
    });
    await createBusiness(db, {
      status: 'active',
      location: { lat: 35.72, lng: 51.42 },
    });
    const totalA = await repo.countInBbox(bbox, cityA.id);
    expect(totalA).toBe(1);
    const clustersA = await repo.findClusters({
      bbox,
      zoom: 4,
      mode: 'clusters',
      cellDeg: 0.1,
      cityId: cityA.id,
      pointLimit: 1000,
    });
    expect(clustersA).toHaveLength(1);
    expect(clustersA[0]?.count).toBe(1);
  });

  it('soft-deleted businesses never appear on the map', async () => {
    if (!repo || !db) return;
    const gone = await createBusiness(db, {
      status: 'active',
      location: { lat: 35.7, lng: 51.4 },
    });
    await db.update(businesses).set({ deletedAt: new Date() }).where(eq(businesses.id, gone.id));
    const points = await repo.findPoints({
      bbox,
      zoom: 16,
      mode: 'points',
      cellDeg: 0,
      pointLimit: 1000,
    });
    expect(points.some((p) => p.id === gone.id)).toBe(false);
  });
});
