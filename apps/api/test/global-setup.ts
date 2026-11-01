/**
 * Q0.1 global test setup for the API package. Runs once per vitest process
 * (configured in vitest.config.ts) and fills the env vars every test needs
 * BEFORE any module import validates them. Individual specs may still
 * override a value at the top of their file for a scenario.
 */
export function setup(): void {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.API_PORT = process.env.API_PORT ?? '4100';
  // Tests always use the :3100 origin (every spec's `ORIGIN` constant + the
  // CSRF guard compare against it). The dev .env ships PUBLIC_WEB_URL=:3000
  // for the web app; `??` would let that leak into tests and break every
  // cookie-authenticated unsafe request with a CSRF mismatch. Override
  // unconditionally so the test world is self-consistent.
  process.env.PUBLIC_WEB_URL = 'http://localhost:3100';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5432/app_test';
  process.env.TEST_DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5432/app_test';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/15';
  process.env.TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
  process.env.DEV_TOOLS = process.env.DEV_TOOLS ?? 'true';
  // Auth (B1.3): test-only secrets (never real ones), short-ish TTLs.
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-0123456789abcdef0123456789abcdef';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-0123456789abcdef0123456789abcdef';
  process.env.OTP_HMAC_SECRET =
    process.env.OTP_HMAC_SECRET ?? 'test-otp-hmac-secret-0123456789abcdef0123456789';
  process.env.ACCESS_TTL_SEC = process.env.ACCESS_TTL_SEC ?? '900';
  process.env.REFRESH_TTL_DAYS = process.env.REFRESH_TTL_DAYS ?? '30';
  process.env.COOKIE_DOMAIN = process.env.COOKIE_DOMAIN ?? '';
  process.env.COOKIE_SECURE = process.env.COOKIE_SECURE ?? 'false';
}
