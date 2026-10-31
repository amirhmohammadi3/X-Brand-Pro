import { describe, expect, it } from 'vitest';
import { iranMobileSchema } from '../primitives.js';

describe('iranMobileSchema', () => {
  const valid: Array<[string, string]> = [
    ['09123456789', '+989123456789'],
    ['0912 345 6789', '+989123456789'],
    ['+98 912 345 6789', '+989123456789'],
    ['+989123456789', '+989123456789'],
    ['00989123456789', '+989123456789'],
    ['0098 912 345 6789', '+989123456789'],
    ['9123456789', '+989123456789'],
    ['۰۹۱۲۳۴۵۶۷۸۹', '+989123456789'],
    ['٠٩١٢٣٤٥٦٧٨٩', '+989123456789'],
    ['0912-345-6789', '+989123456789'],
    ['(0912) 345 6789', '+989123456789'],
    ['09901234567', '+989901234567'],
    ['09931234567', '+989931234567'],
  ];

  it.each(valid)('accepts %s → %s', (input, expected) => {
    expect(iranMobileSchema.parse(input)).toBe(expected);
  });

  const invalid: string[] = [
    '0812345678', // landline (starts with 0 then 8)
    '0912345678', // too short (9 digits)
    '091234567890', // too long (11 digits after 0)
    '09123456789a', // letters
    '1234567890', // not starting with 09/9/+989/00989
    '+99123456789', // wrong country code (+99)
    '09812345678', // operator digit 8 invalid (must be 0-3 or 9)
    'abcdefghij', // letters only
    '', // empty
  ];

  it.each(invalid)('rejects %s', (input) => {
    expect(() => iranMobileSchema.parse(input)).toThrow();
  });

  it('rejects phone with too few digits after normalization', () => {
    expect(() => iranMobileSchema.parse('09123')).toThrow();
  });
});
