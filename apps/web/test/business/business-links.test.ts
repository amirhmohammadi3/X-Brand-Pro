import { describe, expect, it } from 'vitest';
import {
  whatsappUrl,
  telegramUrl,
  instagramUrl,
  websiteUrl,
  directionsUrl,
} from '../../src/lib/business-links';

/**
 * F4.1 — outbound contact/directions URL builders (pure). These are
 * user-clicked navigation hyperlinks; the host literals live in the source
 * tagged `// external-ok`. The builders normalize handles/phones and never
 * return a broken link (null in → null out; garbage in → null out).
 */
describe('business-links', () => {
  it('whatsappUrl strips everything but digits', () => {
    expect(whatsappUrl('+98 912 345 6789')).toBe('https://wa.me/989123456789');
    expect(whatsappUrl('0912-345-6789')).toBe('https://wa.me/09123456789');
    expect(whatsappUrl(null)).toBeNull();
    expect(whatsappUrl('no digits here')).toBeNull();
  });

  it('telegramUrl strips a leading @', () => {
    expect(telegramUrl('@foo')).toBe('https://t.me/foo');
    expect(telegramUrl('bar')).toBe('https://t.me/bar');
    expect(telegramUrl(null)).toBeNull();
    expect(telegramUrl('   ')).toBeNull();
  });

  it('instagramUrl strips a leading @', () => {
    expect(instagramUrl('@baz')).toBe('https://instagram.com/baz');
    expect(instagramUrl('qux')).toBe('https://instagram.com/qux');
    expect(instagramUrl(null)).toBeNull();
  });

  it('websiteUrl prepends https:// only when the scheme is missing', () => {
    expect(websiteUrl('example.com')).toBe('https://example.com');
    expect(websiteUrl('https://example.com')).toBe('https://example.com');
    expect(websiteUrl('http://example.com')).toBe('http://example.com');
    expect(websiteUrl(null)).toBeNull();
  });

  it('directionsUrl builds a Google Maps directions link with lat,lng', () => {
    expect(directionsUrl(35.6892, 51.389)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=35.6892,51.389',
    );
  });
});
