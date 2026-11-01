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

  // --- oauth (B1.8): base URL used to build the Google callback URL
  // `${OAUTH_REDIRECT_BASE}/api/v1/auth/google/callback`. Defaults to the
  // internal API URL; must be a PUBLIC reachability URL in production. ---
  OAUTH_REDIRECT_BASE: z.string().url().optional(),

  // --- otp (B1.4) ---
  OTP_HMAC_SECRET: z.string().min(32, 'must be at least 32 characters'),

  // --- email (B1.6): Mailpit defaults for dev; settings keys email.smtp.* /
  // email.from.* (B1.1 registry) override these when they are set. ---
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('no-reply@localhost'),

  // --- storage / media (B1.9) ---
  // Only `disk` exists now; S3-compatible drivers come with B11.x.
  STORAGE_DRIVER: z.enum(['disk']).default('disk'),
  STORAGE_ROOT: z.string().default('./data/uploads'),
  // Public URL prefix stored in media URLs (`/media/<key>` in dev; a CDN or
  // media host would set e.g. `https://media.example.com`).
  MEDIA_PUBLIC_BASE: z.string().default('/media'),
  // Decompression-bomb guard: refuse inputs whose declared pixels exceed this.
  MAX_IMAGE_PIXELS: z.coerce.number().int().min(1_000_000).default(50_000_000),
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
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });
    throw new Error(
      `Invalid environment configuration — fix these and restart:\n${issues.join('\n')}\n` +
        `See .env.example for the full list of variables and their formats.`,
    );
  }
  // Startup assertion (B1.5): the dev tools surface (raw outbox endpoints)
  // can never be enabled in production, regardless of a misconfigured env.
  if (parsed.data.DEV_TOOLS && parsed.data.NODE_ENV === 'production') {
    throw new Error(
      'Invalid environment configuration — fix these and restart:\n' +
        '  - DEV_TOOLS: cannot be true when NODE_ENV is production\n' +
        'See .env.example for the full list of variables and their formats.',
    );
  }
  return parsed.data;
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
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  storageDriver: Env['STORAGE_DRIVER'];
  /** Root directory the disk driver writes into (resolved at use time). */
  storageRoot: string;
  /** URL prefix stored in media urls, e.g. `/media` -> `/media/<key>`. */
  mediaPublicBase: string;
  maxImagePixels: number;
  accessTtlSec: number;
  refreshTtlDays: number;
  /** Refresh TTL expressed in seconds for cookie maxAge and expires_at math. */
  refreshTtlSec: number;
  cookieDomain: string | undefined;
  /** Defaults to true in production, false otherwise (overridable by env). */
  cookieSecure: boolean;
  /** Base for the OAuth callback URL (B1.8); falls back to API_INTERNAL_URL. */
  oauthRedirectBase: string;
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
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpSecure: env.SMTP_SECURE,
    smtpUser: env.SMTP_USER,
    smtpPassword: env.SMTP_PASSWORD,
    smtpFrom: env.SMTP_FROM,
    storageDriver: env.STORAGE_DRIVER,
    storageRoot: env.STORAGE_ROOT,
    mediaPublicBase: env.MEDIA_PUBLIC_BASE,
    maxImagePixels: env.MAX_IMAGE_PIXELS,
    accessTtlSec: env.ACCESS_TTL_SEC,
    refreshTtlDays: env.REFRESH_TTL_DAYS,
    refreshTtlSec: env.REFRESH_TTL_DAYS * 86_400,
    cookieDomain: env.COOKIE_DOMAIN,
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    oauthRedirectBase: env.OAUTH_REDIRECT_BASE ?? env.API_INTERNAL_URL,
  });
}
