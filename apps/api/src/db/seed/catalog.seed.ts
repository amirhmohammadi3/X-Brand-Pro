import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { cities, neighborhoods } from '../schema/geo.js';
import { categories, amenities, type NewCategoryRow } from '../schema/catalog.js';
import { businesses, businessCategories, businessAmenities } from '../schema/business.js';
import { businessHours } from '../schema/hours.js';
import { loadEnv } from '../../config/env.js';
import { registerSeeder } from './registry.js';

/**
 * Catalog seeders (B2.10) — Tehran + neighborhoods, the two-level category
 * tree, amenities, and demo businesses with weekly hours. All `always`-mode
 * and idempotent:
 *  - cities/categories/amenities upsert by their UNIQUE slug
 *    (onConflictDoNothing — admin edits are never overwritten);
 *  - neighborhoods upsert by the (city_id, slug) uniqueness;
 *  - demo businesses upsert by slug; their category/amenity links and weekly
 *    hours are inserted ONLY when the business row itself was newly created,
 *    so a reseed never duplicates the child rows of an existing demo.
 *
 * Demo businesses are `is_demo = true`, unclaimed (owner_id null — they
 * exercise the B2.9 claim flow) and `active` with `published_at` stamped (the
 * businesses CHECK requires it). They carry NO photos/menu: those need real
 * uploaded media rows and are left to the owner flows.
 *
 * NOTE (Docker-blocked): like every seeder this runs only on a machine with
 * Postgres (`pnpm db:seed`); the DATA below is exercised pure by
 * catalog.seed.spec.ts (slugs unique, fa in every name, depth ≤ 2, coordinates
 * inside the city bbox, active ⇒ published, weekday range, no overlap).
 */

// ─── Seed data (exported for the pure spec) ───────────────────────────────

export interface SeedCity {
  slug: string;
  name: { fa: string; en: string };
  center: { lng: number; lat: number };
  bbox: { west: number; south: number; east: number; north: number };
  timezone: string;
}

export const SEED_CITY: SeedCity = {
  slug: 'tehran',
  name: { fa: 'تهران', en: 'Tehran' },
  center: { lng: 51.389, lat: 35.6892 },
  bbox: { west: 51.05, south: 35.55, east: 51.65, north: 35.83 },
  timezone: 'Asia/Tehran',
};

export interface SeedNeighborhood {
  slug: string;
  name: { fa: string; en: string };
  center: { lng: number; lat: number };
}

export const SEED_NEIGHBORHOODS: SeedNeighborhood[] = [
  {
    slug: 'markaz',
    name: { fa: 'بازار و مرکز', en: 'Downtown' },
    center: { lng: 51.4192, lat: 35.6725 },
  },
  {
    slug: 'valiasr',
    name: { fa: 'ولیعصر', en: 'Valiasr' },
    center: { lng: 51.4161, lat: 35.7448 },
  },
  { slug: 'jordan', name: { fa: 'جردن', en: 'Jordan' }, center: { lng: 51.4261, lat: 35.7623 } },
  {
    slug: 'elahiyeh',
    name: { fa: 'الهیه', en: 'Elahiyeh' },
    center: { lng: 51.4342, lat: 35.7836 },
  },
  {
    slug: 'gheytarieh',
    name: { fa: 'قیطریه', en: 'Gheytarieh' },
    center: { lng: 51.4461, lat: 35.7706 },
  },
  {
    slug: 'saadatabad',
    name: { fa: 'سعادت‌آباد', en: 'Saadatabad' },
    center: { lng: 51.3667, lat: 35.7803 },
  },
  { slug: 'ponak', name: { fa: 'پونک', en: 'Punak' }, center: { lng: 51.3419, lat: 35.7542 } },
  { slug: 'narmak', name: { fa: 'نارمک', en: 'Narmak' }, center: { lng: 51.5063, lat: 35.7383 } },
];

export interface SeedCategory {
  slug: string;
  name: { fa: string; en: string };
  icon: string;
  kind: 'menu' | 'services' | 'none';
  children?: SeedCategory[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'restaurants',
    name: { fa: 'رستوران و فست‌فود', en: 'Restaurants' },
    icon: 'utensils',
    kind: 'menu',
    children: [
      {
        slug: 'restaurants-irani',
        name: { fa: 'ایرانی و سنتی', en: 'Persian' },
        icon: 'soup',
        kind: 'menu',
      },
      {
        slug: 'restaurants-fastfood',
        name: { fa: 'فست‌فود', en: 'Fast food' },
        icon: 'pizza',
        kind: 'menu',
      },
      {
        slug: 'restaurants-italian',
        name: { fa: 'ایتالیایی', en: 'Italian' },
        icon: 'salad',
        kind: 'menu',
      },
    ],
  },
  {
    slug: 'cafes',
    name: { fa: 'کافه', en: 'Cafes' },
    icon: 'coffee',
    kind: 'menu',
    children: [
      {
        slug: 'cafes-book',
        name: { fa: 'کافه‌کتاب', en: 'Book cafe' },
        icon: 'book-open',
        kind: 'menu',
      },
      {
        slug: 'cafes-traditional',
        name: { fa: 'کافه سنتی', en: 'Traditional cafe' },
        icon: 'coffee',
        kind: 'menu',
      },
    ],
  },
  {
    slug: 'health',
    name: { fa: 'پزشکی و سلامت', en: 'Health' },
    icon: 'stethoscope',
    kind: 'services',
    children: [
      {
        slug: 'health-dentist',
        name: { fa: 'دندانپزشکی', en: 'Dentist' },
        icon: 'smile',
        kind: 'services',
      },
      {
        slug: 'health-clinic',
        name: { fa: 'کلینیک', en: 'Clinic' },
        icon: 'heart-pulse',
        kind: 'services',
      },
    ],
  },
  {
    slug: 'beauty',
    name: { fa: 'زیبایی و آرایش', en: 'Beauty' },
    icon: 'scissors',
    kind: 'services',
  },
  { slug: 'shopping', name: { fa: 'فروشگاه', en: 'Shopping' }, icon: 'shopping-bag', kind: 'none' },
  { slug: 'automotive', name: { fa: 'خودرو', en: 'Automotive' }, icon: 'car', kind: 'services' },
  { slug: 'sports', name: { fa: 'ورزش', en: 'Sports' }, icon: 'dumbbell', kind: 'none' },
  {
    slug: 'education',
    name: { fa: 'آموزش', en: 'Education' },
    icon: 'graduation-cap',
    kind: 'services',
  },
];

export interface SeedAmenity {
  slug: string;
  name: { fa: string; en: string };
  icon: string;
  group: 'general' | 'food' | 'payment' | 'accessibility' | 'family' | 'comfort';
}

export const SEED_AMENITIES: SeedAmenity[] = [
  { slug: 'wifi', name: { fa: 'وای‌فای', en: 'Wi-Fi' }, icon: 'wifi', group: 'general' },
  {
    slug: 'parking',
    name: { fa: 'پارکینگ', en: 'Parking' },
    icon: 'square-parking',
    group: 'general',
  },
  {
    slug: 'outdoor',
    name: { fa: 'فضای باز', en: 'Outdoor seating' },
    icon: 'tree-palm',
    group: 'comfort',
  },
  {
    slug: 'card',
    name: { fa: 'کارت بانکی', en: 'Card payment' },
    icon: 'credit-card',
    group: 'payment',
  },
  {
    slug: 'accessible',
    name: { fa: 'دسترسی معلولین', en: 'Wheelchair accessible' },
    icon: 'accessibility',
    group: 'accessibility',
  },
  { slug: 'kids', name: { fa: 'پارک کودک', en: 'Kids area' }, icon: 'baby', group: 'family' },
  {
    slug: 'no-smoking',
    name: { fa: 'سیگار ممنوع', en: 'Non-smoking' },
    icon: 'cigarette-off',
    group: 'comfort',
  },
  {
    slug: 'prayer-room',
    name: { fa: 'نمازخانه', en: 'Prayer room' },
    icon: 'moon',
    group: 'general',
  },
  { slug: 'delivery', name: { fa: 'ارسال', en: 'Delivery' }, icon: 'bike', group: 'food' },
  {
    slug: 'reservable',
    name: { fa: 'رزرو آنلاین', en: 'Online reservation' },
    icon: 'calendar-check',
    group: 'general',
  },
];

export interface SeedBusiness {
  slug: string;
  name: string;
  nameAlt?: string | null;
  description: string;
  neighborhood: string; // seed slug
  primaryCategory: string; // seed slug (may be a child)
  extraCategories: string[];
  amenitySlugs: string[];
  address: string;
  location: { lng: number; lat: number };
  priceLevel: number | null;
  phone: string;
  tags: string[];
  /** Weekly hours: `[weekday(1..7 ISO), open 'HH:mm', close 'HH:mm'][]` — empty = closed all week rows omitted. */
  hours: [number, string, string][];
}

/** Sat–Wed 10–22, Thu 10–23, Fri closed — the common Iranian schedule. */
const STANDARD_HOURS: [number, string, string][] = [
  [6, '10:00', '22:00'],
  [7, '10:00', '22:00'],
  [1, '10:00', '22:00'],
  [2, '10:00', '22:00'],
  [3, '10:00', '22:00'],
  [4, '10:00', '23:00'],
];

export const SEED_BUSINESSES: SeedBusiness[] = [
  {
    slug: 'shater-abbas-markaz',
    name: 'رستوران شاطر عباس',
    nameAlt: 'Shater Abbas',
    description:
      'رستوران سنتی با منوی کامل ایرانی؛ چلوکباب، قرمه‌سبزی و دیزی سنگی در قلب تهران با سالن مجزا برای مهمانی.',
    neighborhood: 'markaz',
    primaryCategory: 'restaurants-irani',
    extraCategories: ['restaurants'],
    amenitySlugs: ['parking', 'card', 'kids', 'prayer-room', 'reservable'],
    address: 'خیابان ۱۵ خرداد، نبش کوچه نصریه، پلاک ۱۲',
    location: { lng: 51.4212, lat: 35.6737 },
    priceLevel: 3,
    phone: '+982155601122',
    tags: ['کباب', 'دیزی', 'سنتی'],
    hours: STANDARD_HOURS,
  },
  {
    slug: 'napoli-pizza-jordan',
    name: 'پیتزای ناپولی',
    nameAlt: 'Napoli Pizza',
    description:
      'پیتزای ایتالیایی با خمیر ۴۸ ساعته و فر سنگی؛ سالاد سزار و پاستای تازه هم در منو سرو می‌شود.',
    neighborhood: 'jordan',
    primaryCategory: 'restaurants-fastfood',
    extraCategories: ['restaurants'],
    amenitySlugs: ['wifi', 'outdoor', 'card', 'delivery'],
    address: 'خیابان جردن، بالاتر از پارک ساعی، پلاک ۴۵',
    location: { lng: 51.4272, lat: 35.7631 },
    priceLevel: 2,
    phone: '+982122034567',
    tags: ['پیتزا', 'پاستا', 'فست‌فود'],
    hours: [...STANDARD_HOURS, [5, '12:00', '23:00']],
  },
  {
    slug: 'khial-cafe-elahiyeh',
    name: 'کافه‌کتاب خیال',
    description:
      'کافه‌کتاب آرام با کتابخانهٔ بیش از دو هزار جلد، قهوهٔ دست‌ساز و دسر خانگی؛ مناسب مطالعه و کار.',
    neighborhood: 'elahiyeh',
    primaryCategory: 'cafes-book',
    extraCategories: ['cafes'],
    amenitySlugs: ['wifi', 'no-smoking', 'card', 'outdoor'],
    address: 'خیابان الهیه، نبش کوچه سلیمی، ساختمان نگار، طبقهٔ همکف',
    location: { lng: 51.4351, lat: 35.7842 },
    priceLevel: 2,
    phone: '+982126109988',
    tags: ['قهوهٔ تخصصی', 'کتاب', 'دسر'],
    hours: [
      [6, '09:00', '23:00'],
      [7, '09:00', '23:00'],
      [1, '09:00', '23:00'],
      [2, '09:00', '23:00'],
      [3, '09:00', '23:00'],
      [4, '09:00', '23:00'],
      [5, '14:00', '23:00'],
    ],
  },
  {
    slug: 'labkhand-dental-saadatabad',
    name: 'کلینیک دندانپزشکی لبخند',
    nameAlt: 'Labkhand Dental Clinic',
    description:
      'کلینیک تخصصی دندانپزشکی با سه یونیت، ایمپلنت و ارتودنسی؛ پذیرش با نوبت‌دهی آنلاین.',
    neighborhood: 'saadatabad',
    primaryCategory: 'health-dentist',
    extraCategories: ['health'],
    amenitySlugs: ['parking', 'accessible', 'card', 'reservable'],
    address: 'بلوار سعادت‌آباد، خیابان علامه شمالی، پلاک ۸۸',
    location: { lng: 51.3682, lat: 35.7812 },
    priceLevel: null,
    phone: '+982123456789',
    tags: ['ایمپلنت', 'ارتودنسی', 'نوبت آنلاین'],
    hours: [
      [6, '10:00', '20:00'],
      [7, '10:00', '20:00'],
      [1, '10:00', '20:00'],
      [2, '10:00', '20:00'],
      [3, '10:00', '20:00'],
    ],
  },
  {
    slug: 'aqsai-barber-gheytarieh',
    name: 'آرایشگاه آقای',
    description: 'آرایشگاه مردانه با سرویس اصلاح مو، صورت و ماساژ سر؛ بدون نوبت، پذیرش حضوری.',
    neighborhood: 'gheytarieh',
    primaryCategory: 'beauty',
    extraCategories: [],
    amenitySlugs: ['card'],
    address: 'خیابان قیطریه، بین میدان هروی و نیکان، پلاک ۲۳',
    location: { lng: 51.4455, lat: 35.7715 },
    priceLevel: 2,
    phone: '+982122778899',
    tags: ['آرایشگاه مردانه', 'اصلاح'],
    hours: [...STANDARD_HOURS, [5, '10:00', '19:00']],
  },
  {
    slug: 'pars-gym-narmak',
    name: 'باشگاه پارس',
    description:
      'باشگاه بدنسازی و فیتنس با دستگاه‌های نوس، مربی خصوصی و سالن هوازی جداگانه برای بانوان.',
    neighborhood: 'narmak',
    primaryCategory: 'sports',
    extraCategories: [],
    amenitySlugs: ['parking', 'accessible', 'card', 'reservable'],
    address: 'نارمک، خیابان گلبرگ، نبش میدان ۷۲، پلاک ۱۰',
    location: { lng: 51.5071, lat: 35.7395 },
    priceLevel: 2,
    phone: '+982177119900',
    tags: ['بدنسازی', 'فیتنس', 'بانوان'],
    hours: [
      [6, '07:00', '23:00'],
      [7, '07:00', '23:00'],
      [1, '07:00', '23:00'],
      [2, '07:00', '23:00'],
      [3, '07:00', '23:00'],
      [4, '07:00', '22:00'],
      [5, '09:00', '14:00'],
    ],
  },
];

// ─── Seeder implementations ───────────────────────────────────────────────

function point(lng: number, lat: number) {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

/** `HH:mm` → `HH:mm:ss` for the time columns; `24:00` is end-of-day. */
function toDbTime(hhmm: string): string {
  return hhmm.length === 5 ? `${hhmm}:00` : hhmm;
}

/** Whether `p` lies inside the (inclusive) bbox — used by the pure spec too. */
export function insideBbox(
  p: { lng: number; lat: number },
  bbox: { west: number; south: number; east: number; north: number },
): boolean {
  return p.lng >= bbox.west && p.lng <= bbox.east && p.lat >= bbox.south && p.lat <= bbox.north;
}

/** Root + child rows with parent linkage by slug (pure; used by seed + spec). */
export function buildCategoryRows(
  tree: SeedCategory[],
): Array<Omit<NewCategoryRow, 'parentId'> & { parentSlug: string | null }> {
  const rows: Array<Omit<NewCategoryRow, 'parentId'> & { parentSlug: string | null }> = [];
  for (const root of tree) {
    rows.push({
      slug: root.slug,
      name: root.name,
      description: null,
      icon: root.icon,
      color: null,
      kind: root.kind,
      supportsReservation: false,
      isActive: true,
      sortOrder: rows.length,
      updatedAt: new Date(),
      parentSlug: null,
    });
    for (const child of root.children ?? []) {
      rows.push({
        slug: child.slug,
        name: child.name,
        description: null,
        icon: child.icon,
        color: null,
        kind: child.kind,
        supportsReservation: false,
        isActive: true,
        sortOrder: (root.children ?? []).indexOf(child),
        updatedAt: new Date(),
        parentSlug: root.slug,
      });
    }
  }
  return rows;
}

export async function seedTehranGeo(databaseUrl: string, log: (m: string) => void): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });
    const cityRows = await db
      .insert(cities)
      .values({
        slug: SEED_CITY.slug,
        name: SEED_CITY.name,
        center: point(SEED_CITY.center.lng, SEED_CITY.center.lat),
        bbox: SEED_CITY.bbox,
        timezone: SEED_CITY.timezone,
        isActive: true,
        sortOrder: 1,
      })
      .onConflictDoNothing({ target: cities.slug })
      .returning({ id: cities.id });
    const cityRowsAll = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.slug, SEED_CITY.slug))
      .limit(1);
    const cityId = cityRows[0]?.id ?? cityRowsAll[0]?.id;
    if (!cityId) throw new Error('tehran city row missing after upsert');
    log(cityRows.length > 0 ? 'city tehran created' : 'city tehran already present');

    let created = 0;
    for (const [i, n] of SEED_NEIGHBORHOODS.entries()) {
      const inserted = await db
        .insert(neighborhoods)
        .values({
          cityId,
          slug: n.slug,
          name: n.name,
          center: point(n.center.lng, n.center.lat),
          isActive: true,
          sortOrder: i,
        })
        .onConflictDoNothing()
        .returning({ id: neighborhoods.id });
      created += inserted.length;
    }
    log(`${created} neighborhoods created, ${SEED_NEIGHBORHOODS.length - created} already present`);
  } finally {
    await pool.end();
  }
}

export async function seedCatalog(databaseUrl: string, log: (m: string) => void): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });

    // Amenities first (independent), upsert by unique slug.
    let amenityCreated = 0;
    for (const [i, a] of SEED_AMENITIES.entries()) {
      const inserted = await db
        .insert(amenities)
        .values({
          slug: a.slug,
          name: a.name,
          icon: a.icon,
          group: a.group,
          isActive: true,
          sortOrder: i,
        })
        .onConflictDoNothing({ target: amenities.slug })
        .returning({ id: amenities.id });
      amenityCreated += inserted.length;
    }
    log(`amenities: ${amenityCreated} created, ${SEED_AMENITIES.length - amenityCreated} present`);

    // Categories: roots must exist before children (parent_id lookup by slug).
    const rows = buildCategoryRows(SEED_CATEGORIES);
    const idBySlug = new Map<string, string>();
    let rootsCreated = 0;
    let childrenCreated = 0;
    for (const row of rows) {
      let parentId: string | null = null;
      if (row.parentSlug) {
        parentId = idBySlug.get(row.parentSlug) ?? null;
        if (!parentId) throw new Error(`parent ${row.parentSlug} missing for ${row.slug}`);
      }
      const { parentSlug, ...values } = row;
      void parentSlug;
      const inserted = await db
        .insert(categories)
        .values(parentId !== null ? { ...values, parentId } : values)
        .onConflictDoNothing({ target: categories.slug })
        .returning({ id: categories.id });
      const existing = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, row.slug))
        .limit(1);
      const id = inserted[0]?.id ?? existing[0]?.id;
      if (!id) throw new Error(`category ${row.slug} missing after upsert`);
      idBySlug.set(row.slug, id);
      if (parentSlug === null) rootsCreated += inserted.length;
      else childrenCreated += inserted.length;
    }
    log(`categories: ${rootsCreated} roots + ${childrenCreated} children created`);
  } finally {
    await pool.end();
  }
}

export async function seedDemoBusinesses(
  databaseUrl: string,
  log: (m: string) => void,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const db = drizzle(pool, { casing: 'snake_case' });

    const city = (
      await db
        .select({ id: cities.id })
        .from(cities)
        .where(eq(cities.slug, SEED_CITY.slug))
        .limit(1)
    )[0];
    if (!city) throw new Error('seed order violation: tehran city missing (run geo seeder first)');

    const neighborhoodIds = new Map<string, string>();
    for (const n of SEED_NEIGHBORHOODS) {
      const row = (
        await db
          .select({ id: neighborhoods.id })
          .from(neighborhoods)
          .where(eq(neighborhoods.slug, n.slug))
          .limit(1)
      )[0];
      if (row) neighborhoodIds.set(n.slug, row.id);
    }

    const categoryIds = new Map<string, string>();
    for (const row of buildCategoryRows(SEED_CATEGORIES)) {
      const r = (
        await db
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.slug, row.slug))
          .limit(1)
      )[0];
      if (r) categoryIds.set(row.slug, r.id);
    }

    const amenityIds = new Map<string, string>();
    for (const a of SEED_AMENITIES) {
      const r = (
        await db
          .select({ id: amenities.id })
          .from(amenities)
          .where(eq(amenities.slug, a.slug))
          .limit(1)
      )[0];
      if (r) amenityIds.set(a.slug, r.id);
    }

    let created = 0;
    let skipped = 0;
    for (const biz of SEED_BUSINESSES) {
      const neighborhoodId = neighborhoodIds.get(biz.neighborhood);
      const primaryCategoryId = categoryIds.get(biz.primaryCategory);
      if (!neighborhoodId || !primaryCategoryId) {
        throw new Error(`seed order violation for ${biz.slug}: neighborhood/category missing`);
      }
      const inserted = await db
        .insert(businesses)
        .values({
          slug: biz.slug,
          name: biz.name,
          nameAlt: biz.nameAlt ?? null,
          description: biz.description,
          cityId: city.id,
          neighborhoodId,
          primaryCategoryId,
          address: biz.address,
          location: point(biz.location.lng, biz.location.lat),
          priceLevel: biz.priceLevel,
          phone: biz.phone,
          status: 'active',
          ownerId: null, // unclaimed on purpose — exercises the B2.9 claim flow
          isDemo: true,
          tags: biz.tags,
          source: 'manual',
          publishedAt: new Date(), // the CHECK requires published for `active`
        })
        .onConflictDoNothing({ target: businesses.slug })
        .returning({ id: businesses.id });

      const businessId = inserted[0]?.id;
      if (!businessId) {
        skipped += 1;
        continue; // already present: never duplicate links/hours of an existing demo
      }
      created += 1;

      const categoryIdsToLink = Array.from(
        new Set([biz.primaryCategory, ...biz.extraCategories]),
      ).map((slug) => categoryIds.get(slug));
      for (const cid of categoryIdsToLink) {
        if (!cid) throw new Error(`category link missing for ${biz.slug}`);
        await db
          .insert(businessCategories)
          .values({ businessId, categoryId: cid, isPrimary: cid === primaryCategoryId })
          .onConflictDoNothing();
      }
      for (const slug of biz.amenitySlugs) {
        const aid = amenityIds.get(slug);
        if (!aid) throw new Error(`amenity ${slug} missing for ${biz.slug}`);
        await db
          .insert(businessAmenities)
          .values({ businessId, amenityId: aid })
          .onConflictDoNothing();
      }
      for (const [weekday, open, close] of biz.hours) {
        const crosses = close < open;
        await db.insert(businessHours).values({
          businessId,
          weekday,
          openTime: toDbTime(open),
          closeTime: toDbTime(close),
          crossesMidnight: crosses,
          allDay: false,
          sortOrder: weekday,
        });
      }
    }
    log(`demo businesses: ${created} created, ${skipped} already present`);
  } finally {
    await pool.end();
  }
}

function seedDatabaseUrl(): string {
  const env = loadEnv();
  return process.argv.includes('--test')
    ? env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL ?? env.DATABASE_URL);
}

registerSeeder({
  name: 'geo-tehran',
  run: async () => {
    await seedTehranGeo(seedDatabaseUrl(), (m) =>
      process.stdout.write(`[db:seed] geo-tehran: ${m}\n`),
    );
  },
});

registerSeeder({
  name: 'catalog-categories-amenities',
  run: async () => {
    await seedCatalog(seedDatabaseUrl(), (m) => process.stdout.write(`[db:seed] catalog: ${m}\n`));
  },
});

registerSeeder({
  name: 'businesses-demo',
  run: async () => {
    await seedDemoBusinesses(seedDatabaseUrl(), (m) =>
      process.stdout.write(`[db:seed] businesses-demo: ${m}\n`),
    );
  },
});
