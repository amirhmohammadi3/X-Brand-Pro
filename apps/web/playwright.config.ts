import { defineConfig, devices } from '@playwright/test';

/**
 * E2E + accessibility config (Q0.1). The web dev server starts on WEB_PORT
 * (default 3000; CI and the sandbox use 3100 via PORT to avoid clashes) and
 * is reused when already running. Retries only on CI. Axe runs per page in
 * the specs (DESIGN.md section 9 — WCAG 2.2 AA).
 */
const PORT = Number(process.env.WEB_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Desktop chrome is the primary e2e target for phase 0; mobile + RTL
    // visual matrices arrive with the page-type prompts (F3+).
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // CI runs the production build (E2E_SERVER=prod); local runs use dev for
    // a fast feedback loop. Both listen on the same port.
    command:
      process.env.E2E_SERVER === 'prod'
        ? 'pnpm exec next start --port 3100'
        : 'pnpm exec next dev --port 3100',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
