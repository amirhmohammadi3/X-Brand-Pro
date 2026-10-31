import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Phase-0 smoke + accessibility spec. Deeper page-type specs (search,
 * business, dashboard, admin) arrive with their own prompts; this one guards
 * the skeleton contract: locale negotiation, direction attributes, tokens
 * and a clean axe scan on both locales.
 *
 * Locale is driven through Playwright's context `locale` option (it sets
 * Accept-Language for every request); extraHTTPHeaders would DUPLICATE the
 * header next to the context's own and confuse negotiation.
 */
test.describe('fa locale (Q0.1)', () => {
  test.use({ locale: 'fa-IR' });

  test('serves fa RTL on the unprefixed URL', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'fa');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('data-theme', 'modern');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('axe finds no WCAG 2.2 AA violations on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('en locale (Q0.1)', () => {
  test.use({ locale: 'en-US' });

  test('negotiates en and prefixes the URL', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.url()).toContain('/en');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/discover/i);
  });

  test('direct /en visit renders LTR English', async ({ page }) => {
    await page.goto('/en');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
  });

  test('axe finds no WCAG 2.2 AA violations on /en', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2aa']).analyze();
    expect(results.violations).toEqual([]);
  });
});
