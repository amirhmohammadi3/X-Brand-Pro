import { describe, expect, it } from 'vitest';
import {
  emailSchema,
  isoDateSchema,
  localeCodeSchema,
  localizedTextSchema,
  moneyIrrSchema,
  passwordSchema,
  slugSchema,
  usernameSchema,
  uuidSchema,
} from '../primitives.js';

describe('usernameSchema', () => {
  it('lowercases and trims', () => {
    expect(usernameSchema.parse('  Amir_Dev  ')).toBe('amir_dev');
  });

  it('accepts letter-start with digits and underscores', () => {
    expect(usernameSchema.parse('a1_b2')).toBe('a1_b2');
  });

  it('rejects shorter than 3 chars', () => {
    expect(() => usernameSchema.parse('ab')).toThrow();
  });

  it('rejects longer than 30 chars', () => {
    expect(() => usernameSchema.parse('a'.repeat(31))).toThrow();
  });

  it('rejects starting with a digit', () => {
    expect(() => usernameSchema.parse('1abc')).toThrow();
  });

  it('rejects reserved names', () => {
    for (const reserved of ['admin', 'root', 'support', 'api', 'www', 'me', 'system']) {
      expect(() => usernameSchema.parse(reserved)).toThrow(/reserved/);
    }
  });

  it('rejects non-latin characters', () => {
    expect(() => usernameSchema.parse('کاربر')).toThrow();
  });
});

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  User@Example.COM ')).toBe('user@example.com');
  });

  it('rejects missing TLD', () => {
    expect(() => emailSchema.parse('user@example')).toThrow();
  });

  it('rejects spaces', () => {
    expect(() => emailSchema.parse('user name@example.com')).toThrow();
  });

  it('rejects longer than 254 chars', () => {
    const local = 'a'.repeat(250);
    expect(() => emailSchema.parse(`${local}@example.com`)).toThrow();
  });
});

describe('passwordSchema', () => {
  it('accepts 8+ chars with letter and digit', () => {
    expect(passwordSchema.parse('abc12345')).toBe('abc12345');
  });

  it('rejects shorter than 8', () => {
    expect(() => passwordSchema.parse('ab1')).toThrow();
  });

  it('rejects without a digit', () => {
    expect(() => passwordSchema.parse('abcdefgh')).toThrow();
  });

  it('rejects without a letter', () => {
    expect(() => passwordSchema.parse('12345678')).toThrow();
  });

  it('rejects longer than 128', () => {
    expect(() => passwordSchema.parse(`a1${'a'.repeat(127)}`)).toThrow();
  });
});

describe('uuidSchema', () => {
  it('accepts a valid uuid', () => {
    expect(uuidSchema.parse('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('rejects a non-uuid', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });
});

describe('slugSchema', () => {
  it('accepts latin slug', () => {
    expect(slugSchema.parse('my-cool-cafe')).toBe('my-cool-cafe');
  });

  it('accepts persian slug', () => {
    expect(slugSchema.parse('کافه-کتاب')).toBe('کافه-کتاب');
  });

  it('rejects spaces', () => {
    expect(() => slugSchema.parse('my cool cafe')).toThrow();
  });

  it('rejects uppercase', () => {
    expect(() => slugSchema.parse('My-Cafe')).toThrow();
  });
});

describe('localeCodeSchema', () => {
  it('accepts fa, en, fa-IR, en-US', () => {
    for (const v of ['fa', 'en', 'fa-IR', 'en-US']) {
      expect(localeCodeSchema.parse(v)).toBe(v);
    }
  });

  it('rejects uppercase language or lowercase region', () => {
    expect(() => localeCodeSchema.parse('FA')).toThrow();
    expect(() => localeCodeSchema.parse('fa-ir')).toThrow();
  });

  it('rejects three-letter codes', () => {
    expect(() => localeCodeSchema.parse('fas')).toThrow();
  });
});

describe('localizedTextSchema', () => {
  it('requires non-empty fa', () => {
    expect(localizedTextSchema.parse({ fa: 'کافه', en: 'Cafe' })).toEqual({
      fa: 'کافه',
      en: 'Cafe',
    });
  });

  it('rejects missing fa', () => {
    expect(() => localizedTextSchema.parse({ en: 'Cafe' })).toThrow();
  });

  it('rejects empty fa', () => {
    expect(() => localizedTextSchema.parse({ fa: '  ' })).toThrow();
  });
});

describe('isoDateSchema', () => {
  it('accepts ISO datetime', () => {
    expect(isoDateSchema.parse('2026-10-31T10:00:00Z')).toBe('2026-10-31T10:00:00Z');
  });

  it('accepts ISO date only', () => {
    expect(isoDateSchema.parse('2026-10-31')).toBe('2026-10-31');
  });

  it('rejects non-date strings', () => {
    expect(() => isoDateSchema.parse('not a date')).toThrow();
  });
});

describe('moneyIrrSchema', () => {
  it('accepts non-negative integers', () => {
    expect(moneyIrrSchema.parse(0)).toBe(0);
    expect(moneyIrrSchema.parse(1_500_000)).toBe(1_500_000);
  });

  it('rejects negative', () => {
    expect(() => moneyIrrSchema.parse(-1)).toThrow();
  });

  it('rejects floats', () => {
    expect(() => moneyIrrSchema.parse(1.5)).toThrow();
  });

  it('rejects unsafe integers', () => {
    expect(() => moneyIrrSchema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
