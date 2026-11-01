import { z, type ZodType } from 'zod';

/**
 * The settings registry (B1.1) — EVERY settings key must be registered here
 * before SettingsService will read or write it, with its own Zod schema,
 * default, group, visibility and secret flag (AGENTS.md section 6).
 *
 * The mechanism ships in B1.1 with two neutral example keys; feature prompts
 * register their own keys (B1.5 SMS drivers, B1.6 email, B1.13 theme packs,
 * B10.2 maintenance mode …) by adding one entry here.
 */
export type SettingsGroup = 'general' | 'localization' | 'integrations' | 'theme' | 'flags';

export type SettingDefinition<T = unknown> = {
  key: string;
  schema: ZodType<T>;
  default: T;
  group: SettingsGroup;
  /** Served unauthenticated via GET /settings/public (never for secrets). */
  public: boolean;
  /** Encrypted at rest (AES-256-GCM), masked in admin listings. */
  isSecret: boolean;
  description: string;
};

/** IANA timezone validation via Intl (no timezone database dependency). */
const ianaTimezoneSchema: ZodType<string> = z
  .string()
  .min(3)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid IANA timezone');

export const settingsRegistry: Readonly<Record<string, SettingDefinition<unknown>>> = {
  'site.name': {
    key: 'site.name',
    schema: z.string().min(1).max(100),
    default: 'Local Business Directory',
    group: 'general',
    public: true,
    isSecret: false,
    description: 'Display name of the platform (the product name itself lives in brand.ts).',
  },
  'site.timezone': {
    key: 'site.timezone',
    schema: ianaTimezoneSchema,
    default: 'Asia/Tehran',
    group: 'general',
    public: true,
    isSecret: false,
    description: 'Fallback IANA timezone for business-hours logic (AGENTS.md section 6).',
  },
  'site.locale': {
    key: 'site.locale',
    schema: z.enum(['fa', 'en']),
    default: 'fa',
    group: 'localization',
    public: true,
    isSecret: false,
    description: 'Site default locale — used when a user has no locale of their own (B1.5).',
  },
  // SMS delivery (B1.5) — the active provider is `sms.provider`; driver
  // credentials are secrets (encrypted at rest, masked in listings) and are
  // read by the drivers at send time, never cached in plaintext.
  'sms.provider': {
    key: 'sms.provider',
    schema: z.enum(['fake', 'melipayamak', 'kavenegar']),
    default: 'fake',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Active SMS driver: fake (dev outbox), melipayamak or kavenegar.',
  },
  'sms.melipayamak.username': {
    key: 'sms.melipayamak.username',
    schema: z.string().max(100),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'Melipayamak panel username (secret).',
  },
  'sms.melipayamak.password': {
    key: 'sms.melipayamak.password',
    schema: z.string().max(100),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'Melipayamak panel password (secret).',
  },
  'sms.melipayamak.sender': {
    key: 'sms.melipayamak.sender',
    schema: z.string().max(20),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Melipayamak sender line (service number), e.g. 5000…',
  },
  'sms.melipayamak.otpBodyId': {
    key: 'sms.melipayamak.otpBodyId',
    schema: z.string().max(20),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Melipayamak base-service body id for OTP templates; empty = plain text.',
  },
  'sms.kavenegar.apiKey': {
    key: 'sms.kavenegar.apiKey',
    schema: z.string().max(100),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'Kavenegar API key (secret), used in the REST URL path.',
  },
  'sms.kavenegar.sender': {
    key: 'sms.kavenegar.sender',
    schema: z.string().max(20),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Kavenegar sender line, e.g. 10004346; empty = provider default.',
  },
  'sms.kavenegar.otpTemplate': {
    key: 'sms.kavenegar.otpTemplate',
    schema: z.string().max(60),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Kavenegar verify/lookup template name for OTP; empty = plain text.',
  },
  // OTP engine (B1.4) — consumed by OtpService; changing them applies to the
  // NEXT issued code, never to codes already in flight.
  'otp.length': {
    key: 'otp.length',
    schema: z.number().int().min(4).max(8),
    default: 6,
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Number of digits in one-time codes (4–8).',
  },
  'otp.ttlSec': {
    key: 'otp.ttlSec',
    schema: z.number().int().min(60).max(600),
    default: 120,
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Seconds a one-time code stays valid (60–600).',
  },
  'otp.maxAttempts': {
    key: 'otp.maxAttempts',
    schema: z.number().int().min(1).max(10),
    default: 5,
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Failed verification attempts allowed before a code is dead (1–10).',
  },
  // Email delivery (B1.6) — an empty/null value means "not set, use the
  // matching SMTP_* env default". The SMTP password is a secret (encrypted at
  // rest, masked in listings) and is read at send time, never cached.
  'email.smtp.host': {
    key: 'email.smtp.host',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'SMTP server host; empty = SMTP_HOST env (default Mailpit localhost).',
  },
  'email.smtp.port': {
    key: 'email.smtp.port',
    schema: z.number().int().min(0).max(65535).nullable(),
    default: null,
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'SMTP server port; null = SMTP_PORT env (default Mailpit 1025).',
  },
  'email.smtp.secure': {
    key: 'email.smtp.secure',
    schema: z.boolean().nullable(),
    default: null,
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'TLS from the start (port 465 style); null = SMTP_SECURE env.',
  },
  'email.smtp.user': {
    key: 'email.smtp.user',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'SMTP auth user; empty = SMTP_USER env (Mailpit needs no auth).',
  },
  'email.smtp.password': {
    key: 'email.smtp.password',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'SMTP auth password (secret); empty = SMTP_PASSWORD env.',
  },
  'email.from.address': {
    key: 'email.from.address',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'From address for outgoing mail; empty = SMTP_FROM env.',
  },
  'email.from.name': {
    key: 'email.from.name',
    schema: z.string().max(100),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Display name in the From header; empty = brand name for the locale.',
  },
};

export function getSettingDefinition(key: string): SettingDefinition<unknown> | undefined {
  return settingsRegistry[key];
}

export function listSettingDefinitions(): SettingDefinition<unknown>[] {
  return Object.values(settingsRegistry);
}

const testOnlyRegistry: Record<string, SettingDefinition<unknown>> = {};

/**
 * Test-only extension point: registers a temporary definition WITHOUT
 * touching the production registry. Used by unit tests to exercise secret
 * storage paths; production keys are always declared statically above.
 */
export function registerSettingDefinitionForTests(definition: SettingDefinition<unknown>): void {
  testOnlyRegistry[definition.key] = definition;
}

/** Internal lookup order: production registry first, then test-only. */
export function lookupSettingDefinition(key: string): SettingDefinition<unknown> | undefined {
  return settingsRegistry[key] ?? testOnlyRegistry[key];
}

/** Every known definition (production + test-only), sorted by key. */
export function listAllSettingDefinitions(): SettingDefinition<unknown>[] {
  return [...Object.values(settingsRegistry), ...Object.values(testOnlyRegistry)].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
}
