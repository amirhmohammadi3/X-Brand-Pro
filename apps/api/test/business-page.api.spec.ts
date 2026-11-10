import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap/configure-app.js';
import { SESSIONS_REPOSITORY } from '../src/modules/auth/session.repository.js';
import { USERS_REPOSITORY } from '../src/modules/users/users.service.js';
import { AUDIT_SERVICE } from '../src/modules/audit/audit.service.js';
import { REDIS } from '../src/redis/redis.client.js';
import { QUEUES_SERVICE } from '../src/queue/queue.module.js';
import { SETTINGS_REPOSITORY } from '../src/modules/settings/settings.service.js';
import { BusinessesService } from '../src/modules/business/businesses.service.js';
import { HoursService } from '../src/modules/business/hours/hours.service.js';
import { PhotosService } from '../src/modules/business/photos/photos.service.js';
import { MenuService } from '../src/modules/business/menu/menu.service.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { QaService } from '../src/modules/qa/qa.service.js';
import { FakeRedis } from './fake-redis.js';
import { makeMemorySessionRepo, makeMemoryUserRepo } from './auth.utils.js';

/**
 * HTTP-level aggregate-page tests (B4.9) WITHOUT live services: the six
 * composed services are tiny fakes (the composition is what this endpoint
 * IS — every underlying read has its own spec), Redis is FakeRedis, users/
 * sessions in-memory, audit a spy. The REAL controller route, guards,
 * query validation, envelope and exception filter run for real here.
 */

const BIZ_ID = '11111111-1111-4111-8111-111111111111';

const fakeDetail = {
  id: BIZ_ID,
  slug: 'cafe-naderi',
  name: 'کافه نادری',
  nameAlt: null,
  primaryCategory: { id: 'cc', slug: 'cafe', name: { fa: 'کافه' } },
  city: { id: 'city', slug: 'tehran', name: { fa: 'تهران', en: 'Tehran' } },
  neighborhood: null,
  address: 'خیابان جمهوری، پلاک ۱۲',
  location: { lat: 35.7, lng: 51.4 },
  priceLevel: 2,
  avgRating: 4.25,
  reviewCount: 8,
  coverUrl: null,
  thumbUrl: null,
  isFeatured: false,
  isClaimed: true,
  ownerId: null,
  description: 'قدیمی‌ترین کافهٔ تهران',
  phone: '+989121234567',
  whatsapp: null,
  telegram: null,
  instagram: null,
  website: null,
  email: null,
  amenities: [],
  categories: [{ id: 'cc', slug: 'cafe', name: { fa: 'کافه' }, isPrimary: true }],
  tags: [],
  status: 'active',
  source: 'manual',
  rejectionReason: null,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
};

const fakeHours = {
  weekly: [{ weekday: 1, intervals: [{ open: '08:00', close: '17:00' }] }],
  specialDays: [],
  openStatus: { isOpen: true },
};

const fakePhoto = {
  id: '22222222-2222-4222-8222-222222222222',
  businessId: BIZ_ID,
  mediaId: '33333333-3333-4333-8333-333333333333',
  url: 'https://media.example/1.webp',
  thumbUrl: null,
  width: null,
  height: null,
  sortOrder: 0,
  createdAt: '2026-11-11T00:00:00.000Z',
};

const fakeReview = {
  id: '44444444-4444-4444-8444-444444444444',
  businessId: BIZ_ID,
  userId: '55555555-5555-4555-8555-555555555555',
  authorName: null,
  authorUsername: 'reviewer01',
  rating: 5,
  body: 'کیفیت خدمات فوق‌العاده بود و پرسنل بسیار محترم.',
  status: 'approved',
  photoUrl: null,
  helpfulCount: 0,
  unhelpfulCount: 0,
  verified: false,
  checkinVerified: false,
  checkinAt: null,
  receiptUrl: null,
  isFirstReview: false,
  authorLevel: 'newcomer',
  editedAt: null,
  reply: null,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
};

let app: INestApplication;
let redis: FakeRedis;
// Plain arrays, NOT vi.fn: vitest's clearMocks/restoreMocks wipes mock state
// between tests (the reviews.api.spec precedent) — call RECORDING must survive.
const detailCalls: Array<[unknown, string]> = [];
const reviewCalls: Array<[string, { page: number; pageSize: number }]> = [];

beforeAll(async () => {
  redis = new FakeRedis();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REDIS)
    .useValue(redis)
    .overrideProvider(SESSIONS_REPOSITORY)
    .useValue(makeMemorySessionRepo())
    .overrideProvider(USERS_REPOSITORY)
    .useValue(makeMemoryUserRepo())
    .overrideProvider(QUEUES_SERVICE)
    .useValue({ add: vi.fn(async () => undefined) })
    .overrideProvider(SETTINGS_REPOSITORY)
    .useValue({
      async findAll() {
        return [];
      },
      async findByKey() {
        return null;
      },
      async upsert(row: Record<string, unknown>) {
        return row;
      },
    })
    .overrideProvider(AUDIT_SERVICE)
    .useValue({ log: vi.fn(), write: vi.fn(async () => ({ id: 'a' })) })
    .overrideProvider(BusinessesService)
    .useValue({
      async getBusinessDetail(_actor: unknown, idOrSlug: string) {
        detailCalls.push([_actor, idOrSlug]);
        if (idOrSlug !== BIZ_ID && idOrSlug !== 'cafe-naderi') {
          throw new HttpException(
            {
              code: 'NOT_FOUND',
              messageKey: 'errors.not_found',
              message: `Business ${idOrSlug} not found`,
            },
            HttpStatus.NOT_FOUND,
          );
        }
        return fakeDetail;
      },
    })
    .overrideProvider(HoursService)
    .useValue({
      async getBusinessContext() {
        return { ownerId: null, status: 'active', timezone: 'Asia/Tehran' };
      },
      async getHoursResponse() {
        return fakeHours;
      },
    })
    .overrideProvider(PhotosService)
    .useValue({
      async list() {
        return [fakePhoto];
      },
    })
    .overrideProvider(MenuService)
    .useValue({
      async getMenu() {
        return { sections: [] };
      },
    })
    .overrideProvider(ReviewsService)
    .useValue({
      async listByBusiness(_id: string, q: { page: number; pageSize: number }) {
        reviewCalls.push([_id, q]);
        return {
          items: [fakeReview],
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total: 8,
            totalPages: Math.ceil(8 / q.pageSize),
          },
        };
      },
    })
    .overrideProvider(QaService)
    .useValue({
      async listByBusiness() {
        return { items: [], meta: { page: 1, pageSize: 1, total: 7, totalPages: 7 } };
      },
    })
    .compile();

  const expressApp = moduleRef.createNestApplication<NestExpressApplication>();
  app = expressApp as unknown as INestApplication;
  configureApp(expressApp);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

const getPage = (idOrSlug: string, query = '') =>
  request(app.getHttpServer()).get(`/api/v1/businesses/${idOrSlug}/page${query}`);

describe('GET /api/v1/businesses/:idOrSlug/page (B4.9)', () => {
  it('200 public aggregate: detail + hours + photos + menu + reviews + question count + JSON-LD', async () => {
    const res = await getPage('cafe-naderi');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(data.business.slug).toBe('cafe-naderi');
    expect(data.business.avgRating).toBe(4.25);
    expect(data.hours.openStatus).toEqual({ isOpen: true });
    expect(data.photos).toHaveLength(1);
    expect(data.menu).toEqual({ sections: [] });
    expect(data.reviews.items).toHaveLength(1);
    expect(data.reviews.meta).toMatchObject({ page: 1, pageSize: 5, total: 8 });
    // The Q&A probe reports the APPROVED question count only.
    expect(data.questions).toEqual({ total: 7 });
    expect(data.jsonLd['@context']).toBe('https://schema.org');
    expect(data.jsonLd['@type']).toBe('LocalBusiness');
    expect(data.jsonLd.image).toEqual([fakePhoto.url]);
    expect(data.jsonLd.aggregateRating).toMatchObject({ ratingValue: 4.25, reviewCount: 8 });
  });

  it('resolves by UUID as well as slug', async () => {
    const res = await getPage(BIZ_ID);
    expect(res.status).toBe(200);
    expect(detailCalls.at(-1)).toEqual([undefined, BIZ_ID]);
  });

  it('passes the embedded reviews query through (default 5, custom pageSize)', async () => {
    await getPage('cafe-naderi');
    expect(reviewCalls.at(-1)).toEqual([BIZ_ID, { page: 1, pageSize: 5 }]);
    await getPage('cafe-naderi', '?page=2&pageSize=3');
    expect(reviewCalls.at(-1)).toEqual([BIZ_ID, { page: 2, pageSize: 3 }]);
  });

  it('caps the embedded reviews pageSize at 20 (400 beyond)', async () => {
    const res = await getPage('cafe-naderi', '?pageSize=21');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('404 for an unknown business (the service gate decides; never leaks)', async () => {
    const res = await getPage('no-such-business');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
