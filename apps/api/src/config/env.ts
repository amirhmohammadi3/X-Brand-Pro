import { z } from 'zod';

/**
 * Environment schema. Later prompts EXTEND this schema (and must update
 * .env.example in the same prompt). Never read process.env directly in app
 * code — inject AppConfig instead.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_WEB_URL: z.string().url(),
  API_INTERNAL_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  TEST_REDIS_URL: z.string().min(1),
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((v) => {
      if (v === '') return undefined;
      if (v === 'true') return true as const;
      if (v === 'false') return false as const;
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
      return v; // comma-separated list of ips / subnets
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DEV_TOOLS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // --- auth (B1.3) ---
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_DOMAIN: z
    .string()
    .default('')
    .transform((v) => (v.trim() === '' ? undefined : v.trim())),
  COOKIE_SECURE: z
    .string()
    .default('')
    .transform((v) => (v === '' ? undefined : v === 'true')),

  // --- seed superadmin (B1.3 seeder; read only by the CLI seeder) ---
  SEED_SUPERADMIN_USERNAME: z.string().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().optional(),
  SEED_SUPERADMIN_EMAIL: z.string().optional(),

  // --- otp (B1.4) ---
  OTP_HMAC_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

export type Env = z.infer<typeof envSchema>;

/** Every key the env schema requires — consumed by scripts/check-env.mjs (I1.1). */
export const ENV_KEYS = Object.keys(envSchema.shape) as Array<keyof z.infer<typeof envSchema>>;

/**
 * Parse and validate environment variables. Throws one readable error listing
 * every invalid or missing key at once (fail fast at startup).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  - ${key}: ${issue.message}`;
  });
  throw new Error(
    `Invalid environment configuration — fix these and restart:\n${issues.join('\n')}\n` +
      `See .env.example for the full list of variables and their formats.`,
  );
}

export type AppConfig = Readonly<{
  env: Env;
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  isDevToolsEnabled: boolean;
  apiPort: number;
  publicWebUrl: string;
  apiInternalUrl: string;
  databaseUrl: string;
  testDatabaseUrl: string;
  redisUrl: string;
  testRedisUrl: string;
  trustProxy: boolean | number | string | string[] | undefined;
  logLevel: Env['LOG_LEVEL'];
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  otpHmacSecret: string;
  accessTtlSec: number;
  refreshTtlDays: number;
  /** Refresh TTL expressed in seconds for cookie maxAge and expires_at math. */
  refreshTtlSec: number;
  cookieDomain: string | undefined;
  /** Defaults to true in production, false otherwise (overridable by env). */
  cookieSecure: boolean;
}>;

export function buildAppConfig(env: Env): AppConfig {
  return Object.freeze({
    env,
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevToolsEnabled: env.DEV_TOOLS,
    apiPort: env.API_PORT,
    publicWebUrl: env.PUBLIC_WEB_URL,
    apiInternalUrl: env.API_INTERNAL_URL,
    databaseUrl: env.DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
    redisUrl: env.REDIS_URL,
    testRedisUrl: env.TEST_REDIS_URL,
    trustProxy: env.TRUST_PROXY,
    logLevel: env.LOG_LEVEL,
    jwtAccessSecret: env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: env.JWT_REFRESH_SECRET,
    otpHmacSecret: env.OTP_HMAC_SECRET,
    accessTtlSec: env.ACCESS_TTL_SEC,
    refreshTtlDays: env.REFRESH_TTL_DAYS,
    refreshTtlSec: env.REFRESH_TTL_DAYS * 86_400,
    cookieDomain: env.COOKIE_DOMAIN,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  });
}
