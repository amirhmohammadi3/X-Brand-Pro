import { slugify } from '@app/contracts';
import {
  type Bbox,
  type BusinessStatus,
  type GeoPoint,
  emailSchema,
  instagramHandleSchema,
  iranMobileSchema,
  iranPhoneSchema,
  telegramHandleSchema,
  websiteSchema,
  whatsappSchema,
} from '@app/contracts';

/**
 * Pure business rule helpers for the business catalog (B2.4). No I/O, no DI —
 * these are the domain invariants the repository/service (and later B2.6's HTTP
 * layer) reuse: the status state machine, the location-in-bbox rule, slug
 * derivation with collision avoidance, and contact normalisation.
 */

/** Who is performing a status transition — drives the transition table. */
export type BusinessActorKind = 'owner' | 'admin';

/**
 * Allowed status transitions and who may make them. Every pair not listed is
 * forbidden (canTransition returns false). Source: B2.4 spec.
 * - draft → pending (owner submits)
 * - pending → active | rejected (admin moderates)
 * - rejected → pending (owner edits + resubmits)
 * - active → suspended (admin) | closed (owner or admin)
 * - suspended → active (admin re-enables)
 * - closed → active (owner or admin reopens)
 */
const TRANSITIONS: Record<BusinessStatus, Partial<Record<BusinessStatus, BusinessActorKind[]>>> = {
  draft: { pending: ['owner'] },
  pending: { active: ['admin'], rejected: ['admin'] },
  rejected: { pending: ['owner'] },
  active: { suspended: ['admin'], closed: ['owner', 'admin'] },
  suspended: { active: ['admin'] },
  closed: { active: ['owner', 'admin'] },
};

/** A domain-rule violation thrown by the assert* helpers; the service layer
 * maps it to HTTP 422 with `code: 'UNPROCESSABLE'`. */
export class BusinessRuleError extends Error {
  readonly code = 'UNPROCESSABLE' as const;
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BusinessRuleError';
    this.details = details;
  }
}

/** Iran's rough bounding box — the fallback when a city has no bbox. */
export const IRAN_BBOX: Bbox = { west: 44, south: 25, east: 64, north: 40 };

export class BusinessDomainService {
  /** True iff `actor` may move a business from `from` to `to`. */
  canTransition(from: BusinessStatus, to: BusinessStatus, actor: BusinessActorKind): boolean {
    const allowed = TRANSITIONS[from]?.[to];
    return Array.isArray(allowed) && allowed.includes(actor);
  }

  /**
   * Assert the location lies inside the city's bbox when one is set, else
   * inside Iran's rough bbox (25..40 N, 44..64 E). Throws BusinessRuleError
   * with `details.kind = 'city' | 'iran'` and the violated bbox otherwise.
   */
  assertLocationInsideCityBbox(location: GeoPoint, cityBbox: Bbox | null): void {
    const bbox = cityBbox ?? IRAN_BBOX;
    const inside =
      location.lng >= bbox.west &&
      location.lng <= bbox.east &&
      location.lat >= bbox.south &&
      location.lat <= bbox.north;
    if (!inside) {
      throw new BusinessRuleError('location is outside the allowed bounding box', {
        kind: cityBbox ? 'city' : 'iran',
        bbox,
        location,
      });
    }
  }

  /**
   * Derive a unique slug from the business name (falling back to the city name
   * when the name slugifies to empty, e.g. an emoji-only name), appending `-2`,
   * `-3`, … on collision. `exists(slug)` must report whether the slug is taken
   * (the repository implements it against `businesses.slug`).
   */
  async generateUniqueSlug(
    name: string,
    cityName: string,
    exists: (slug: string) => Promise<boolean>,
  ): Promise<string> {
    const base = slugify(name) || slugify(cityName);
    if (!base) {
      throw new BusinessRuleError('slug could not be derived from name or city', { field: 'slug' });
    }
    let slug = base;
    let n = 2;
    while (await exists(slug)) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }

  /**
   * Normalise the contact fields a create/update body may carry through their
   * Zod schemas (E.164 phones, extracted handles, http(s) URLs, lowercased
   * email). Each field is `null` when absent. Throws the Zod error verbatim if
   * a non-null value fails its schema (the HTTP layer maps it to 400).
   */
  normalizeContacts(raw: {
    phone?: string | null;
    whatsapp?: string | null;
    telegram?: string | null;
    instagram?: string | null;
    website?: string | null;
    email?: string | null;
  }): {
    phone: string | null;
    whatsapp: string | null;
    telegram: string | null;
    instagram: string | null;
    website: string | null;
    email: string | null;
  } {
    const opt = <T, S extends { parse: (v: unknown) => T }>(
      schema: S,
      v: string | null | undefined,
    ): T | null => (v == null || v === '' ? null : schema.parse(v));
    return {
      phone: opt(iranPhoneSchema, raw.phone),
      whatsapp: opt(whatsappSchema, raw.whatsapp),
      telegram: opt(telegramHandleSchema, raw.telegram),
      instagram: opt(instagramHandleSchema, raw.instagram),
      website: opt(websiteSchema, raw.website),
      email: opt(emailSchema, raw.email),
    };
  }
}

// Re-export the input schema used by iranPhone for callers that want the raw
// transform without going through the class.
export { iranMobileSchema, iranPhoneSchema };
