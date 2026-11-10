import { describe, expect, it } from 'vitest';
import {
  businessJsonLdSchema,
  businessPageQuerySchema,
  businessPageQuestionsSchema,
  businessPageReviewsSchema,
  businessPageSchema,
} from '../business-page.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('business-page contracts (B4.9)', () => {
  it('defaults the embedded reviews page to 5 and caps it at 20', () => {
    expect(businessPageQuerySchema.parse({})).toEqual({ page: 1, pageSize: 5 });
    expect(businessPageQuerySchema.parse({ pageSize: '20' })).toEqual({ page: 1, pageSize: 20 });
    expect(businessPageQuerySchema.safeParse({ pageSize: 21 }).success).toBe(false);
    expect(businessPageQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });

  it('accepts a fully-shaped page aggregate and an empty jsonLd record', () => {
    const page = {
      business: {
        id: UUID,
        slug: 'cafe-naderi',
        name: 'کافه نادری',
        nameAlt: null,
        primaryCategory: { id: UUID, slug: 'cafe', name: { fa: 'کافه' } },
        city: { id: UUID, slug: 'tehran', name: { fa: 'تهران' } },
        neighborhood: null,
        address: 'خیابان جمهوری',
        location: { lat: 35.7, lng: 51.4 },
        priceLevel: null,
        avgRating: 4.25,
        reviewCount: 8,
        coverUrl: null,
        thumbUrl: null,
        isFeatured: false,
        isClaimed: true,
        ownerId: null,
        description: null,
        phone: null,
        whatsapp: null,
        telegram: null,
        instagram: null,
        website: null,
        email: null,
        amenities: [],
        categories: [],
        tags: [],
        status: 'active' as const,
        source: 'manual' as const,
        rejectionReason: null,
        createdAt: '2026-11-11T00:00:00.000Z',
        updatedAt: '2026-11-11T00:00:00.000Z',
      },
      hours: {
        weekly: [],
        specialDays: [],
        openStatus: { isOpen: false, state: 'closed', nextChangeAt: null, todayIntervals: [] },
      },
      photos: [],
      menu: { sections: [] },
      reviews: { items: [], meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } },
      questions: { total: 7 },
      jsonLd: { '@context': 'https://schema.org', '@type': 'LocalBusiness' },
    };
    expect(businessPageSchema.safeParse(page).success).toBe(true);
    expect(businessPageQuestionsSchema.parse({ total: 0 })).toEqual({ total: 0 });
    expect(
      businessPageReviewsSchema.safeParse({
        items: [],
        meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 },
      }).success,
    ).toBe(true);
    expect(businessJsonLdSchema.parse({})).toEqual({});
    expect(businessJsonLdSchema.safeParse('not-an-object').success).toBe(false);
  });
});
