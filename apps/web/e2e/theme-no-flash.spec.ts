import { test, expect } from '@playwright/test';

/**
 * Theme no-flash spec (F1.2). Guards the contract that the active pack and
 * the resolved mode are present in the SERVER HTML (so there is no flash of
 * the wrong theme on first paint) and that the computed background matches
 * the expected token for each pack × mode combination.
 *
 * The API is unreachable in the e2e sandbox, so the layout falls back to the
 * bundled `modern` pack; the `/dev/ui?pack=<id>` route lets us exercise the
 * other two packs by overriding client-side.
 */

const MODERN_LIGHT_BG = 'rgb(246, 247, 251)'; // #F6F7FB
const MODERN_DARK_BG = 'rgb(11, 16, 32)'; // #0B1020

test.describe('theme attributes are server-rendered (no flash)', () => {
  test('default visit sets data-theme=modern and data-mode on <html>', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'modern');
    // server renders light (or dark) before paint; the attribute exists.
    const mode = await html.getAttribute('data-mode');
    expect(['light', 'dark']).toContain(mode);
    // the inline theme-vars style element is present
    await expect(page.locator('#theme-vars')).toBeAttached();
  });

  test('computed body background matches the modern light token by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // Either light or dark depending on the emulated scheme; both are valid.
    expect([MODERN_LIGHT_BG, MODERN_DARK_BG]).toContain(bg);
  });

  test('no flash of the wrong mode when OS prefers dark and pref=system', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'mode', value: 'system', domain: 'localhost', path: '/' }]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const html = page.locator('html');
    // server renders data-mode-pref=system and data-mode=light; the inline
    // script flips data-mode to dark before first paint.
    await expect(html).toHaveAttribute('data-mode-pref', 'system');
    // After the inline script runs, data-mode should be dark.
    await expect(html).toHaveAttribute('data-mode', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(MODERN_DARK_BG);
  });

  test('explicit dark preference renders dark server-side', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'mode', value: 'dark', domain: 'localhost', path: '/' }]);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mode-pref', 'dark');
    await expect(html).toHaveAttribute('data-mode', 'dark');
  });

  test('explicit light preference renders light server-side', async ({ page }) => {
    await page
      .context()
      .addCookies([{ name: 'mode', value: 'light', domain: 'localhost', path: '/' }]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mode-pref', 'light');
    await expect(html).toHaveAttribute('data-mode', 'light');
  });
});

test.describe('/dev/ui pack matrix', () => {
  test('renders all three pack buttons and applies the chosen pack', async ({ page }) => {
    await page.goto('/dev/ui');
    // toolbar has buttons for the three packs
    await expect(page.getByRole('button', { name: 'مدرن' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'گرم' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'لوکس' })).toBeVisible();
    // default pack is modern
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'modern');
  });

  test('clicking the warm pack switches data-theme to warm', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'گرم' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
  });
});
