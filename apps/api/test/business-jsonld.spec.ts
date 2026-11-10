import { describe, expect, it } from 'vitest';
import {
  buildBusinessJsonLd,
  weeklyToOpeningHours,
} from '../src/modules/business/businesses-jsonld.js';
import type { HoursResponse } from '@app/contracts';

/**
 * B4.9 — the schema.org JSON-LD builder, pure: the @-skeleton, the
 * optional-field omission rules (undefined NEVER serialises as null — the
 * web client injects the object verbatim), the gallery→image mapping, the
 * zero-review aggregateRating rule (schema.org forbids a rating without
 * reviews) and the weekly-schedule → openingHoursSpecification mapping
 * (allDay → 00:00–23:59, `24:00` close → 23:59, closed days omitted).
 */

const detail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'کافه نادری',
  nameAlt: 'Cafe Naderi' as string | null,
  description: 'قدیمی‌ترین کافهٔ تهران' as string | null,
  address: 'خیابان جمهوری، پلاک ۱۲',
  location: { lat: 35.7, lng: 51.4 },
  phone: '+989121234567' as string | null,
  priceLevel: 2,
  avgRating: 4.25,
  reviewCount: 8,
  city: { id: 'c', slug: 'tehran', name: { fa: 'تهران', en: 'Tehran' } },
};

const photo = (url: string) => ({
  id: '22222222-2222-4222-8222-222222222222',
  businessId: detail.id,
  mediaId: '33333333-3333-4333-8333-333333333333',
  url,
  thumbUrl: null,
  width: null,
  height: null,
  sortOrder: 0,
  createdAt: '2026-11-11T00:00:00.000Z',
});

const hours = (weekly: HoursResponse['weekly']): HoursResponse => ({
  weekly,
  specialDays: [],
  openStatus: {
    isOpen: true,
    /** The exact openStatus shape is the hours contract's business — the
     * builder never reads it, so a minimal stand-in suffices here. */
  } as HoursResponse['openStatus'],
});

describe('buildBusinessJsonLd (B4.9)', () => {
  it('always emits @context + @type + the required name/address/geo trio', () => {
    const jsonLd = buildBusinessJsonLd({
      detail: { ...detail, nameAlt: null, description: null, phone: null },
      photos: [],
      hours: hours([]),
    });
    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('LocalBusiness');
    expect(jsonLd.name).toBe('کافه نادری');
    expect(jsonLd.address).toMatchObject({
      '@type': 'PostalAddress',
      streetAddress: 'خیابان جمهوری، پلاک ۱۲',
      addressLocality: 'تهران',
      addressCountry: 'IR',
    });
    expect(jsonLd.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 35.7, longitude: 51.4 });
  });

  it('omits optional fields when null (never serialises undefined as null)', () => {
    const jsonLd = buildBusinessJsonLd({
      detail: { ...detail, nameAlt: null, description: null, phone: null },
      photos: [],
      hours: hours([]),
    });
    expect('description' in jsonLd).toBe(false);
    expect('alternateName' in jsonLd).toBe(false);
    expect('telephone' in jsonLd).toBe(false);
  });

  it('keeps optional fields when present and maps the gallery to image', () => {
    const jsonLd = buildBusinessJsonLd({
      detail,
      photos: [photo('https://media.example/1.webp'), photo('https://media.example/2.webp')],
      hours: hours([]),
    });
    expect(jsonLd.description).toBe('قدیمی‌ترین کافهٔ تهران');
    expect(jsonLd.alternateName).toBe('Cafe Naderi');
    expect(jsonLd.telephone).toBe('+989121234567');
    expect(jsonLd.image).toEqual(['https://media.example/1.webp', 'https://media.example/2.webp']);
  });

  it('emits aggregateRating only when reviewCount > 0', () => {
    const withReviews = buildBusinessJsonLd({
      detail,
      photos: [],
      hours: hours([]),
    });
    expect(withReviews.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.25,
      reviewCount: 8,
      bestRating: 5,
      worstRating: 1,
    });
    const withoutReviews = buildBusinessJsonLd({
      detail: { ...detail, reviewCount: 0, avgRating: 0 },
      photos: [],
      hours: hours([]),
    });
    expect('aggregateRating' in withoutReviews).toBe(false);
  });

  it('maps the weekly schedule: intervals, allDay and closed days', () => {
    const specs = weeklyToOpeningHours(
      hours([
        {
          weekday: 1,
          intervals: [
            { open: '08:00', close: '12:00' },
            { open: '16:00', close: '24:00' },
          ],
        },
        { weekday: 2, intervals: [{ open: '08:00', close: '23:00' }] },
        { weekday: 3, allDay: true },
        { weekday: 5, intervals: [] },
      ]),
    );
    // Monday: two intervals — the first passes through verbatim, the second's
    // 24:00 close becomes 23:59 (schema.org times).
    expect(specs[0]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'Monday',
      opens: '08:00',
      closes: '12:00',
    });
    expect(specs[1]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'Monday',
      opens: '16:00',
      closes: '23:59',
    });
    // Tuesday verbatim.
    expect(specs[2]).toMatchObject({ dayOfWeek: 'Tuesday', opens: '08:00', closes: '23:00' });
    // Wednesday allDay → 00:00–23:59.
    expect(specs[3]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'Wednesday',
      opens: '00:00',
      closes: '23:59',
    });
    // Friday (no intervals) is omitted; exactly 4 specs in total.
    expect(specs).toHaveLength(4);
    expect(specs.some((s) => s.dayOfWeek === 'Friday')).toBe(false);
  });

  it('the whole object survives a JSON round-trip losslessly', () => {
    const jsonLd = buildBusinessJsonLd({
      detail,
      photos: [photo('https://m.example/1.webp')],
      hours: hours([{ weekday: 6, allDay: true }]),
    });
    const parsed = JSON.parse(JSON.stringify(jsonLd)) as Record<string, unknown>;
    expect(parsed).toEqual(jsonLd);
  });
});
