import { describe, expect, it } from 'vitest';
import {
  BusinessDomainService,
  BusinessRuleError,
  IRAN_BBOX,
  type BusinessActorKind,
} from '../src/modules/business/businesses.domain.js';
import {
  instagramHandleSchema,
  iranPhoneSchema,
  telegramHandleSchema,
  whatsappSchema,
  type BusinessStatus,
} from '@app/contracts';
import type { GeoPoint } from '@app/contracts';

/**
 * BusinessDomainService unit tests (B2.4) — pure domain rules, no DB. Covers
 * the full status transition table (every from×to×actor pair), the
 * location-in-bbox rule (city bbox + Iran fallback), slug derivation with
 * Persian names and collision avoidance, and the contact normalisers (phones,
 * Instagram/Telegram URL extraction, WhatsApp). Repository round-trip +
 * constraint tests live in businesses.repository.spec.ts (DB-requiring).
 */
const svc = new BusinessDomainService();

const STATUSES: BusinessStatus[] = [
  'draft',
  'pending',
  'active',
  'suspended',
  'rejected',
  'closed',
];
const ACTORS: BusinessActorKind[] = ['owner', 'admin'];

/** The allowed transitions as `${from}>${to}>${actor}` tokens. */
const ALLOWED = new Set<string>([
  'draft>pending>owner',
  'pending>active>admin',
  'pending>rejected>admin',
  'rejected>pending>owner',
  'active>suspended>admin',
  'active>closed>owner',
  'active>closed>admin',
  'suspended>active>admin',
  'closed>active>owner',
  'closed>active>admin',
]);

describe('BusinessDomainService — canTransition (B2.4)', () => {
  it('allows exactly the spec transitions and forbids every other pair', () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const actor of ACTORS) {
          const token = `${from}>${to}>${actor}`;
          const expected = ALLOWED.has(token);
          // same-status is never a transition
          if (from === to) {
            expect(svc.canTransition(from, to, actor)).toBe(false);
          } else {
            expect(svc.canTransition(from, to, actor)).toBe(expected);
          }
        }
      }
    }
  });

  it('lets an owner submit a draft, then an admin activate it', () => {
    expect(svc.canTransition('draft', 'pending', 'owner')).toBe(true);
    expect(svc.canTransition('pending', 'active', 'admin')).toBe(true);
  });

  it('forbids an owner from activating their own pending business', () => {
    expect(svc.canTransition('pending', 'active', 'owner')).toBe(false);
  });

  it('lets an owner reopen a closed business but not a suspended one', () => {
    expect(svc.canTransition('closed', 'active', 'owner')).toBe(true);
    expect(svc.canTransition('suspended', 'active', 'owner')).toBe(false);
  });

  it('forbids re-submitting an active business as pending', () => {
    expect(svc.canTransition('active', 'pending', 'owner')).toBe(false);
    expect(svc.canTransition('active', 'pending', 'admin')).toBe(false);
  });
});

describe('BusinessDomainService — assertLocationInsideCityBbox (B2.4)', () => {
  const tehranBbox = { west: 51.0, south: 35.55, east: 51.6, north: 35.85 };
  const inside: GeoPoint = { lat: 35.6892, lng: 51.389 };
  const outside: GeoPoint = { lat: 35.4, lng: 51.2 }; // south of Tehran bbox

  it('passes when the location is inside the city bbox', () => {
    expect(() => svc.assertLocationInsideCityBbox(inside, tehranBbox)).not.toThrow();
  });

  it('throws BusinessRuleError with kind=city when outside the city bbox', () => {
    try {
      svc.assertLocationInsideCityBbox(outside, tehranBbox);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessRuleError);
      expect((err as BusinessRuleError).details.kind).toBe('city');
    }
  });

  it('falls back to Iran bbox when the city has no bbox and the point is in Iran', () => {
    const inIran: GeoPoint = { lat: 32.0, lng: 53.0 };
    expect(() => svc.assertLocationInsideCityBbox(inIran, null)).not.toThrow();
  });

  it('throws BusinessRuleError with kind=iran when no city bbox and outside Iran', () => {
    const farAway: GeoPoint = { lat: 50.0, lng: 10.0 }; // Europe
    try {
      svc.assertLocationInsideCityBbox(farAway, null);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(BusinessRuleError);
      expect((err as BusinessRuleError).details.kind).toBe('iran');
      expect((err as BusinessRuleError).details.bbox).toEqual(IRAN_BBOX);
    }
  });
});

describe('BusinessDomainService — generateUniqueSlug (B2.4)', () => {
  it('slugifies a Persian name into a URL-safe slug', async () => {
    const taken: string[] = [];
    const slug = await svc.generateUniqueSlug('کافه رحیمی', 'تهران', (s) =>
      Promise.resolve(taken.includes(s)),
    );
    expect(slug).toBe('کافه-رحیمی');
  });

  it('appends -2, -3 on collision', async () => {
    const taken = ['کافه-رحیمی', 'کافه-رحیمی-2'];
    const slug = await svc.generateUniqueSlug('کافه رحیمی', 'تهران', (s) =>
      Promise.resolve(taken.includes(s)),
    );
    expect(slug).toBe('کافه-رحیمی-3');
  });

  it('falls back to the city name when the name slugifies to empty', async () => {
    const slug = await svc.generateUniqueSlug('☕☕☕', 'اصفهان', () => Promise.resolve(false));
    expect(slug).toBe('اصفهان');
  });

  it('throws when neither name nor city slugifies to anything', async () => {
    await expect(
      svc.generateUniqueSlug('☕', '☕', () => Promise.resolve(false)),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe('BusinessDomainService — normalizeContacts (B2.4)', () => {
  it('normalises a mobile and a landline phone to E.164', () => {
    const c = svc.normalizeContacts({ phone: '09121234567', whatsapp: null });
    expect(c.phone).toBe('+989121234567');
    expect(c.whatsapp).toBeNull();
  });

  it('normalises a landline 021xxxxxxxx to +9821xxxxxxxx', () => {
    const c = svc.normalizeContacts({ phone: '02112345678' });
    expect(c.phone).toBe('+982112345678');
  });

  it('accepts +98 landline and Persian digits', () => {
    const c = svc.normalizeContacts({ phone: '۰۹۱۲۱۲۳۴۵۶۷' });
    expect(c.phone).toBe('+989121234567');
  });

  it('extracts an Instagram handle from a full URL and lowercases it', () => {
    const c = svc.normalizeContacts({ instagram: 'https://instagram.com/Cafe.Rahimi' });
    expect(c.instagram).toBe('cafe.rahimi');
  });

  it('strips a leading @ from an Instagram handle', () => {
    const c = svc.normalizeContacts({ instagram: '@Cafe_Rahimi' });
    expect(c.instagram).toBe('cafe_rahimi');
  });

  it('extracts a Telegram handle from a t.me URL', () => {
    const c = svc.normalizeContacts({ telegram: 'https://t.me/rahimi_cafe' });
    expect(c.telegram).toBe('rahimi_cafe');
  });

  it('normalises a WhatsApp number from a wa.me URL', () => {
    const c = svc.normalizeContacts({ whatsapp: 'https://wa.me/989121234567' });
    expect(c.whatsapp).toBe('+989121234567');
  });

  it('normalises a website and email', () => {
    const c = svc.normalizeContacts({
      website: 'https://cafe-rahimi.ir',
      email: '  Info@Cafe-Rahimi.ir  ',
    });
    expect(c.website).toBe('https://cafe-rahimi.ir');
    expect(c.email).toBe('info@cafe-rahimi.ir');
  });

  it('returns null for absent fields', () => {
    const c = svc.normalizeContacts({});
    expect(c).toEqual({
      phone: null,
      whatsapp: null,
      telegram: null,
      instagram: null,
      website: null,
      email: null,
    });
  });

  it('throws on an invalid phone', () => {
    expect(() => svc.normalizeContacts({ phone: 'not-a-phone' })).toThrow();
  });

  it('throws on an Instagram handle with spaces', () => {
    expect(() => svc.normalizeContacts({ instagram: 'cafe rahimi' })).toThrow();
  });
});

// Direct schema table tests (the normalisers are the schemas themselves).
describe('contact schemas — table tests (B2.4)', () => {
  it.each([
    ['09121234567', '+989121234567'],
    ['+989121234567', '+989121234567'],
    ['00989121234567', '+989121234567'],
    ['9121234567', '+989121234567'],
    ['۰۹۱۲۱۲۳۴۵۶۷', '+989121234567'], // Persian digits
  ])('iranPhoneSchema normalises %s → %s', (input, expected) => {
    expect(iranPhoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    ['02112345678', '+982112345678'],
    ['+982112345678', '+982112345678'],
    ['021 1234 5678', '+982112345678'], // spaces stripped
  ])('iranPhoneSchema normalises landline %s → %s', (input, expected) => {
    expect(iranPhoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    ['https://instagram.com/Cafe.Rahimi', 'cafe.rahimi'],
    ['https://www.instagram.com/My_Cafe', 'my_cafe'],
    ['@CoffeeShop', 'coffeeshop'],
    ['plain.handle', 'plain.handle'],
  ])('instagramHandleSchema extracts %s → %s', (input, expected) => {
    expect(instagramHandleSchema.parse(input)).toBe(expected);
  });

  it.each([
    ['https://t.me/rahimi_cafe', 'rahimi_cafe'],
    ['@rahimi_cafe', 'rahimi_cafe'],
    ['valid_handle_1', 'valid_handle_1'],
  ])('telegramHandleSchema extracts %s → %s', (input, expected) => {
    expect(telegramHandleSchema.parse(input)).toBe(expected);
  });

  it.each([
    ['09121234567', '+989121234567'],
    ['https://wa.me/989121234567', '+989121234567'],
    ['+989121234567', '+989121234567'],
  ])('whatsappSchema normalises %s → %s', (input, expected) => {
    expect(whatsappSchema.parse(input)).toBe(expected);
  });

  it.each(['not-a-phone', '12345', '081234567890', '+9821123456'])(
    'iranPhoneSchema rejects %s',
    (input) => {
      expect(() => iranPhoneSchema.parse(input)).toThrow();
    },
  );
});
