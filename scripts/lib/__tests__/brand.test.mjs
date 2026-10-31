import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBrandNames,
  isBrandAllowed,
  findBrandOccurrence,
  BRAND_ALLOWED_FILES,
} from '../brand.mjs';

// Synthetic brand names used in tests so this file does not contain the real
// product name (which scripts/check-brand.mjs would flag).
const FA = 'تست‌برند';
const EN = 'TestBrand';

test('extractBrandNames reads nameFa and nameEn from brand.ts source', () => {
  const src = `export const BRAND = {
    nameFa: '${FA}',
    nameEn: '${EN}',
    tagline: { fa: 'x', en: 'y' },
  } as const;`;
  const b = extractBrandNames(src);
  assert.equal(b?.nameFa, FA);
  assert.equal(b?.nameEn, EN);
});

test('extractBrandNames handles double-quoted strings', () => {
  const src = `nameFa: "${FA}", nameEn: "${EN}"`;
  const b = extractBrandNames(src);
  assert.equal(b?.nameFa, FA);
  assert.equal(b?.nameEn, EN);
});

test('extractBrandNames returns null when fields are missing', () => {
  assert.equal(extractBrandNames('export const X = 1;'), null);
  assert.equal(extractBrandNames(`nameFa: "${FA}"`), null);
  assert.equal(extractBrandNames(`nameEn: "${EN}"`), null);
});

test('isBrandAllowed allows brand.ts, docs/, i18n seed, pnpm-lock', () => {
  assert.equal(isBrandAllowed('packages/config/src/brand.ts'), true);
  assert.equal(isBrandAllowed('docs/PROGRESS.md'), true);
  assert.equal(isBrandAllowed('docs/anything.md'), true);
  assert.equal(isBrandAllowed('apps/api/src/modules/i18n/seed/fa.json'), true);
  assert.equal(isBrandAllowed('pnpm-lock.yaml'), true);
  assert.equal(isBrandAllowed('public/brand/mark.svg'), true);
});

test('isBrandAllowed rejects arbitrary source files', () => {
  assert.equal(isBrandAllowed('apps/api/src/main.ts'), false);
  assert.equal(isBrandAllowed('apps/web/src/app/page.tsx'), false);
  assert.equal(isBrandAllowed('README.md'), false);
});

test('findBrandOccurrence finds Persian name (case-sensitive)', () => {
  const text = `line 1\nwelcome to ${FA} platform\nline 3`;
  const line = findBrandOccurrence(text, { nameFa: FA, nameEn: EN });
  assert.equal(line, 2);
});

test('findBrandOccurrence finds English name (case-insensitive)', () => {
  const text = `Welcome to ${EN.toUpperCase()} today`;
  const line = findBrandOccurrence(text, { nameFa: FA, nameEn: EN });
  assert.equal(line, 1);
});

test('findBrandOccurrence returns null when name is absent', () => {
  const text = 'nothing here\nnor here';
  const line = findBrandOccurrence(text, { nameFa: FA, nameEn: EN });
  assert.equal(line, null);
});

test('BRAND_ALLOWED_FILES is a non-empty Set', () => {
  assert.ok(BRAND_ALLOWED_FILES instanceof Set);
  assert.ok(BRAND_ALLOWED_FILES.size > 0);
});
