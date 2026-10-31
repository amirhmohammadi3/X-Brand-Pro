/**
 * Q0.1 global test setup for the API package. Runs once per vitest process
 * (configured in vitest.config.ts) and fills the env vars every test needs
 * BEFORE any module import validates them. Individual specs may still
 * override a value at the top of their file for a scenario.
 */
export function setup(): void {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.API_PORT = process.env.API_PORT ?? '4100';
  process.env.PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3100';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5432/app_test';
  process.env.TEST_DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgres://app:app_dev_password@localhost:5432/app_test';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379/15';
  process.env.TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
  process.env.DEV_TOOLS = process.env.DEV_TOOLS ?? 'true';
}
