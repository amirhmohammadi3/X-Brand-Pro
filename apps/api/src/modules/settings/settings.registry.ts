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
