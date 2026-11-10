import type { BusinessDetail, BusinessPhoto } from '@app/contracts';
import type { HoursResponse } from '@app/contracts';

/**
 * B4.9 — the schema.org JSON-LD object for the business page (SEO). A PURE
 * function: no I/O, no clock, fully unit-testable. The web client injects
 * the returned object verbatim as
 * `<script type="application/ld+json">` — every value must therefore be
 * JSON-safe: `undefined` fields are OMITTED (never null), arrays are plain,
 * the only `@`-keys are the schema.org ones.
 *
 * Type: `LocalBusiness` — the platform serves every vertical (the category
 * → schema.org type mapping lands with the AI/SEO prompts; a follow-up
 * tracks it). `openingHoursSpecification` maps the B2.5 weekly intervals
 * (dayOfWeek 1..7 = Monday..Sunday per ISO-8601, matching the contract);
 * `aggregateRating` appears only when at least one approved review exists
 * (schema.org forbids a rating with zero reviews).
 */

/** The JSON-LD dayOfWeek tokens indexed by the contract's weekday 1..7. */
const WEEKDAY_TOKENS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export interface BusinessJsonLdInput {
  detail: Pick<
    BusinessDetail,
    | 'id'
    | 'name'
    | 'nameAlt'
    | 'description'
    | 'address'
    | 'location'
    | 'phone'
    | 'priceLevel'
    | 'avgRating'
    | 'reviewCount'
    | 'city'
  >;
  photos: BusinessPhoto[];
  hours: HoursResponse;
  /** When provided, `hasMap`/`url` point at the canonical public page. */
  publicUrl?: string;
}

export function buildBusinessJsonLd(input: BusinessJsonLdInput): Record<string, unknown> {
  const { detail, photos, hours } = input;
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: detail.name,
    address: {
      '@type': 'PostalAddress',
      streetAddress: detail.address,
      addressLocality: detail.city.name.fa ?? Object.values(detail.city.name)[0],
      addressCountry: 'IR',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: detail.location.lat,
      longitude: detail.location.lng,
    },
  };
  if (detail.description) jsonLd.description = detail.description;
  if (detail.nameAlt) jsonLd.alternateName = detail.nameAlt;
  if (detail.phone) jsonLd.telephone = detail.phone;
  if (input.publicUrl) jsonLd.url = input.publicUrl;
  const images = photos.map((p) => p.url);
  if (images.length > 0) jsonLd.image = images;
  // schema.org: an AggregateRating with zero reviews is invalid — emit it
  // only when the business actually carries approved reviews.
  if (detail.reviewCount > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: detail.avgRating,
      reviewCount: detail.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }
  const openingHours = weeklyToOpeningHours(hours);
  if (openingHours.length > 0) jsonLd.openingHoursSpecification = openingHours;
  return jsonLd;
}

/**
 * Weekly schedule → `openingHoursSpecification[]`. An `allDay` day maps to
 * 00:00–23:59 (schema.org times are plain HH:mm — `24:00` is not valid);
 * days with no intervals are omitted (the absence of a day means closed).
 */
export function weeklyToOpeningHours(hours: HoursResponse): Array<{
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string;
  opens: string;
  closes: string;
}> {
  const specs: Array<{
    '@type': 'OpeningHoursSpecification';
    dayOfWeek: string;
    opens: string;
    closes: string;
  }> = [];
  for (const day of hours.weekly) {
    const dayOfWeek = WEEKDAY_TOKENS[day.weekday - 1] ?? 'Monday';
    if (day.allDay === true) {
      specs.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek,
        opens: '00:00',
        closes: '23:59',
      });
      continue;
    }
    for (const interval of day.intervals ?? []) {
      specs.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek,
        opens: interval.open,
        closes: interval.close === '24:00' ? '23:59' : interval.close,
      });
    }
  }
  return specs;
}
