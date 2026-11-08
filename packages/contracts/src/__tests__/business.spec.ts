import { describe, expect, it } from 'vitest';
import {
  createBusinessBodySchema,
  updateBusinessBodySchema,
  businessTransitionBodySchema,
} from '../business.js';

/**
 * Business CRUD contracts (B2.6) — schema validation table tests for the
 * create/update bodies and the status-transition body: required-field
 * enforcement, `.strict()` rejection of unknown keys, Persian-digit phone
 * normalisation, the all-optional update shape, and the transition refine
 * (rejectionReason required iff target is `rejected`).
 */

const UUID = '12345678-1234-4321-8765-1234567890ab';
const validCreate = {
  name: 'کافه رحیمی',
  cityId: UUID,
  primaryCategoryId: UUID,
  address: 'ولیعصر، پلاک ۱',
  location: { lat: 35.6892, lng: 51.389 },
};

describe('createBusinessBodySchema (B2.6)', () => {
  it('accepts a minimal valid Persian-named business', () => {
    const out = createBusinessBodySchema.parse(validCreate);
    expect(out.name).toBe('کافه رحیمی');
    expect(out.cityId).toBe(UUID);
    expect(out.location).toEqual({ lat: 35.6892, lng: 51.389 });
  });

  it('accepts contacts and normalises Persian-digit phone to E.164', () => {
    const out = createBusinessBodySchema.parse({
      ...validCreate,
      phone: '۰۹۱۲۳۴۵۶۷۸۹',
      whatsapp: 'https://wa.me/989123456789',
      instagram: 'https://instagram.com/Cafe.Rahimi',
    });
    expect(out.phone).toBe('+989123456789');
    expect(out.whatsapp).toBe('+989123456789');
    expect(out.instagram).toBe('cafe.rahimi');
  });

  it('rejects a missing required field', () => {
    expect(() => createBusinessBodySchema.parse({ ...validCreate, address: undefined })).toThrow();
  });

  it('rejects an unknown key (strict)', () => {
    expect(() => createBusinessBodySchema.parse({ ...validCreate, oops: 1 })).toThrow();
  });

  it('rejects a location outside the geoPoint range', () => {
    expect(() =>
      createBusinessBodySchema.parse({ ...validCreate, location: { lat: 91, lng: 181 } }),
    ).toThrow();
  });

  it('rejects priceLevel outside 1..4', () => {
    expect(() => createBusinessBodySchema.parse({ ...validCreate, priceLevel: 5 })).toThrow();
  });
});

describe('updateBusinessBodySchema (B2.6)', () => {
  it('accepts an empty body (every field optional)', () => {
    expect(updateBusinessBodySchema.parse({})).toEqual({});
  });

  it('accepts a partial update', () => {
    expect(updateBusinessBodySchema.parse({ name: 'کافه نو' })).toEqual({ name: 'کافه نو' });
  });

  it('rejects an unknown key (strict)', () => {
    expect(() => updateBusinessBodySchema.parse({ oops: 1 })).toThrow();
  });

  it('rejects a bad phone even when partial', () => {
    expect(() => updateBusinessBodySchema.parse({ phone: 'not-a-phone' })).toThrow();
  });
});

describe('businessTransitionBodySchema (B2.6)', () => {
  it('accepts { status: "active" }', () => {
    expect(businessTransitionBodySchema.parse({ status: 'active' })).toEqual({ status: 'active' });
  });

  it('accepts { status: "rejected", rejectionReason: "spam" }', () => {
    expect(
      businessTransitionBodySchema.parse({ status: 'rejected', rejectionReason: 'محتوای نادرست' }),
    ).toEqual({ status: 'rejected', rejectionReason: 'محتوای نادرست' });
  });

  it('rejects { status: "rejected" } without a reason', () => {
    expect(() => businessTransitionBodySchema.parse({ status: 'rejected' })).toThrow();
  });

  it('rejects a reason on a non-rejected transition', () => {
    expect(() =>
      businessTransitionBodySchema.parse({ status: 'active', rejectionReason: 'x' }),
    ).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => businessTransitionBodySchema.parse({ status: 'frozen' })).toThrow();
  });

  it('rejects an unknown key (strict)', () => {
    expect(() => businessTransitionBodySchema.parse({ status: 'active', oops: 1 })).toThrow();
  });
});
