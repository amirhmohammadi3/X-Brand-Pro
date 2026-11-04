import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Auth pages e2e (F1.8): register → logout → login with password, and login
 * via the SMS OTP flow using the DEV-ONLY outbox endpoint.
 *
 * Environment requirements (NOT provided by the playwright webServer, which
 * only starts the web app):
 *  - the NestJS API must run on API_URL (default http://localhost:4000/api/v1)
 *    with `DEV_TOOLS=true` so `GET /api/v1/dev/sms-outbox` is mounted;
 *  - the API's `PUBLIC_WEB_URL` must match the WEB origin (playwright.config
 *    uses port 3100, so set PUBLIC_WEB_URL=http://localhost:3100) — the API's
 *    CSRF origin guard rejects cookie-bearing unsafe requests from any other
 *    origin.
 *
 * The API-backed specs self-skip when DEV_TOOLS is not set, mirroring how
 * the sandbox and CI run without services.
 */

const DEV_TOOLS = process.env.DEV_TOOLS === 'true';
const API_URL = process.env.API_URL ?? 'http://localhost:4000/api/v1';

test.describe('auth pages (F1.8)', () => {
  test('login page renders in fa with both method tabs', async ({ page }) => {
    await page.goto('/fa/login');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ورود');
    await expect(page.getByRole('tab', { name: 'ورود با رمز عبور' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ورود با کد یکبار مصرف' })).toBeVisible();
    await expect(page.getByLabel(/نام کاربری، ایمیل یا شماره موبایل/)).toBeVisible();
  });

  test('forgot-password page renders and validates the identifier', async ({ page }) => {
    await page.goto('/fa/forgot-password');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('بازیابی گذرواژه');
    // Empty submit stays client-side and shows the required error.
    await page.getByRole('button', { name: 'ارسال کد بازیابی' }).click();
    await expect(page.getByText('این فیلد الزامی است.')).toBeVisible();
  });

  test('register → logout → login with password', async ({ page }) => {
    test.skip(!DEV_TOOLS, 'requires the API with DEV_TOOLS=true');
    const username = `e2e_${Date.now()}`;

    await page.goto('/register');
    await page.getByLabel(/نام کاربری/).fill(username);
    await page.getByLabel(/گذرواژه/).fill('Passw0rd123');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'ایجاد حساب' }).click();
    await expect(page.getByRole('heading', { name: 'حساب شما ساخته شد' })).toBeVisible();
    // The nudge shows because both email and phone are unverified.
    await expect(page.getByText('ایمیل یا شماره موبایل شما تأیید نشده است')).toBeVisible();

    // Log out through the public shell's user menu.
    await page.goto('/');
    await page.getByRole('button', { name: 'حساب' }).click();
    await page.getByRole('menuitem', { name: 'خروج' }).click();
    await expect(page.getByRole('button', { name: 'ورود' })).toBeVisible();

    // Log back in with the password, honoring the ?next= target.
    await page.goto('/login?next=%2Faccount');
    await page.getByLabel(/نام کاربری، ایمیل یا شماره موبایل/).fill(username);
    await page.getByLabel(/گذرواژه/).fill('Passw0rd123');
    await page.getByRole('button', { name: 'ورود', exact: true }).click();
    await expect(page).toHaveURL(/\/account/);
  });

  test('login via SMS OTP using the dev outbox', async ({ page, request }) => {
    test.skip(!DEV_TOOLS, 'requires the API with DEV_TOOLS=true (dev SMS outbox)');
    const phone = `0912${String(Date.now()).slice(-7)}`;

    await page.goto('/login');
    await page.getByRole('tab', { name: 'ورود با کد یکبار مصرف' }).click();
    await page.getByRole('radio', { name: 'پیامک' }).click();
    await page.getByLabel(/شماره موبایل/).fill(phone);
    await page.getByRole('button', { name: 'ارسال کد' }).click();
    await expect(page.getByText(/کد یکبار مصرف به این نشانی ارسال شد/)).toBeVisible();

    const code = await readOtpCodeFromOutbox(request, phone);

    // The OtpInput renders one textbox per digit (dir=ltr, ASCII digits).
    const cells = page.getByRole('textbox');
    const cellCount = await cells.count();
    for (let i = 0; i < cellCount; i += 1) {
      await cells.nth(i).fill(code[i] ?? '');
    }

    // Success replaces the URL with the safe default target (`/`).
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'حساب' })).toBeVisible();
  });
});

/** Poll the dev outbox for the newest SMS to `phone` and extract the 6-digit code. */
async function readOtpCodeFromOutbox(request: APIRequestContext, phone: string): Promise<string> {
  // The fake driver stores the E.164 target (+98912…); compare digits only,
  // dropping the leading 0 of the national form.
  const wanted = phone.replace(/\D/g, '').replace(/^0/, '');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request.get(`${API_URL}/dev/sms-outbox`);
    if (response.ok()) {
      const items = (await response.json()) as Array<{ to: string; text: string }>;
      const mine = [...items].reverse().find((item) => item.to.replace(/\D/g, '').endsWith(wanted));
      if (mine !== undefined) {
        const match = mine.text.match(/\b(\d{6})\b/);
        if (match !== null && match[1] !== undefined) return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`dev SMS outbox never contained a code for ${phone}`);
}
