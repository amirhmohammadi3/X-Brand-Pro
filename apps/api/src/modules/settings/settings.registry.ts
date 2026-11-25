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
export type SettingsGroup =
  | 'general'
  | 'localization'
  | 'integrations'
  | 'theme'
  | 'flags'
  | 'moderation'
  | 'ai';

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
  // Spam filter (B4.5) — the manageable knobs the prompt asks for. The
  // blocked-word list is normalized Persian text (normalizePersianText, B3.1)
  // matched case-insensitively; the two thresholds feed the Redis velocity/
  // wave counters. Changing a key flushes through SettingsService.set (cache
  // invalidated on write), so the filter re-reads fresh values per review.
  'moderation.spam.blockedWords': {
    key: 'moderation.spam.blockedWords',
    schema: z.array(z.string().min(1).max(60)).max(500),
    default: [],
    group: 'moderation',
    public: false,
    isSecret: false,
    description:
      'Blocked words for the review spam filter (normalized Persian text). A review whose normalized body contains any of these is created pending instead of approved.',
  },
  'moderation.spam.maxReviewsPerHour': {
    key: 'moderation.spam.maxReviewsPerHour',
    schema: z.number().int().min(1).max(1000),
    default: 5,
    group: 'moderation',
    public: false,
    isSecret: false,
    description:
      'Velocity threshold: a user posting MORE reviews than this in one hour has the excess reviews created pending (the counter still increments — the queue sees the pattern).',
  },
  'moderation.spam.maxReviewsPerBusinessPerHour': {
    key: 'moderation.spam.maxReviewsPerBusinessPerHour',
    schema: z.number().int().min(1).max(5000),
    default: 10,
    group: 'moderation',
    public: false,
    isSecret: false,
    description:
      'Wave threshold: more reviews than this for ONE business in one hour flag the excess as pending (coordinated review waves).',
  },
  // SMS delivery (B1.5) — the active provider is `sms.provider`; driver
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
  // Web push (B5.4) — the VAPID identity every push send is signed with.
  // The public key + subject are served to browsers (subscription + UI);
  // the private key NEVER leaves the server and is masked in admin
  // listings. All three empty = web push disabled (PushService skips).
  'push.vapid.publicKey': {
    key: 'push.vapid.publicKey',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: true,
    isSecret: false,
    description: 'VAPID public key (Base64 URL-safe) — shipped to browsers for subscribe.',
  },
  'push.vapid.privateKey': {
    key: 'push.vapid.privateKey',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'VAPID private key (Base64 URL-safe) — signs every push send.',
  },
  'push.vapid.subject': {
    key: 'push.vapid.subject',
    schema: z.string().max(200),
    default: '',
    group: 'integrations',
    public: true,
    isSecret: false,
    description: 'VAPID subject — a mailto: or https: contact URI push services require.',
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
  // --- Google OAuth (B1.8). Disabled by default: Google endpoints are often
  // unreachable from Iranian servers, so the feature must degrade to a 404
  // until an admin explicitly enables it (DECISIONS B1.8). ---
  'oauth.google.enabled': {
    key: 'oauth.google.enabled',
    schema: z.boolean(),
    default: false,
    group: 'integrations',
    public: true,
    isSecret: false,
    description: 'Enable Google OAuth login (start/callback endpoints). Disabled by default.',
  },
  'oauth.google.clientId': {
    key: 'oauth.google.clientId',
    schema: z.string().max(300),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: false,
    description: 'Google OAuth 2.0 client id (web application).',
  },
  'oauth.google.clientSecret': {
    key: 'oauth.google.clientSecret',
    schema: z.string().max(300),
    default: '',
    group: 'integrations',
    public: false,
    isSecret: true,
    description: 'Google OAuth 2.0 client secret (secret, encrypted at rest).',
  },
  // --- Theme packs (B1.13). The active pack id; tokens live in theme_packs. ---
  'theme.activePackId': {
    key: 'theme.activePackId',
    schema: z.enum(['modern', 'warm', 'luxe']),
    default: 'modern',
    group: 'theme',
    public: true,
    isSecret: false,
    description: 'Which builtin theme pack is active (modern, warm, luxe).',
  },
  // --- Geo catalog (B2.1). The default city slug; GET /cities flags the
  // matching active city with `isDefault`. ---
  'geo.defaultCitySlug': {
    key: 'geo.defaultCitySlug',
    schema: z.string().min(1).max(80),
    default: 'tehran',
    group: 'general',
    public: true,
    isSecret: false,
    description:
      'Default city slug; the public cities list flags the matching active city with isDefault.',
  },
  // AI module (Phase 9, A9.1) — the OpenAI-compatible driver config. The
  // apiKey is a secret (encrypted at rest, masked in listings); the rest is
  // admin-readable. The driver + model + baseUrl are read at every call (the
  // service reads through the SettingsService cache, so a settings change
  // takes effect on the next call without a restart). The per-feature
  // enable flags gate each feature separately AND the global `ai.enabled`
  // gate must be on for any of them to fire (the service resolves the AND).
  'ai.enabled': {
    key: 'ai.enabled',
    schema: z.boolean(),
    default: false,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Master switch for the AI module (Phase 9). When false, every feature returns AI_DISABLED without calling the driver — the rule-based fallback (A9.2) is still used by the features that have one.',
  },
  'ai.driver': {
    key: 'ai.driver',
    schema: z.enum(['fake', 'openai', 'rule']),
    default: 'fake',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The driver the AI service will call. fake returns a canned response (no network); openai calls the OpenAI-compatible chat/completions endpoint; rule is the no-model statistical driver (A9.2).',
  },
  'ai.openai.baseUrl': {
    key: 'ai.openai.baseUrl',
    schema: z
      .string()
      .url()
      .max(300)
      // Accept http://localhost (Ollama, LM Studio) and https endpoints.
      .refine((u) => u.startsWith('http://') || u.startsWith('https://'), 'must be http(s)://'),
    default: 'https://api.openai.com/v1',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The base URL the openai driver appends /chat/completions to. Use https://api.openai.com/v1 for OpenAI, an OpenRouter URL, or http://localhost:11434/v1 for Ollama.',
  },
  'ai.openai.apiKey': {
    key: 'ai.openai.apiKey',
    schema: z.string().min(1).max(300),
    default: '',
    group: 'ai',
    public: false,
    isSecret: true,
    description:
      'The API key sent as `Authorization: Bearer <key>`. Encrypted at rest; masked in admin listings. Empty string = not configured (the openai driver returns AI_NO_CREDENTIALS).',
  },
  'ai.openai.model': {
    key: 'ai.openai.model',
    schema: z.string().min(1).max(100),
    default: 'gpt-4o-mini',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The model id sent in the chat/completions request body (e.g. gpt-4o-mini, gpt-4o, llama3:8b for Ollama).',
  },
  'ai.timeoutMs': {
    key: 'ai.timeoutMs',
    schema: z.number().int().min(1000).max(120_000),
    default: 15_000,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Per-call timeout in ms. The driver aborts the fetch after this and returns AI_DRIVER_FAILED (the service retries up to ai.maxRetries).',
  },
  'ai.maxRetries': {
    key: 'ai.maxRetries',
    schema: z.number().int().min(0).max(5),
    default: 2,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Retry count for transient failures (timeout, 5xx, network). Linear backoff: 250ms × attempt. A 4xx is not retried (the request is malformed).',
  },
  'ai.monthlyBudgetTokens': {
    key: 'ai.monthlyBudgetTokens',
    schema: z.number().int().min(0).max(1_000_000_000),
    default: 1_000_000,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Monthly token budget (prompt + completion) summed across all features. When the current month spend reaches this, calls return AI_BUDGET_EXHAUSTED until the next calendar month. 0 disables the cap (unlimited).',
  },
  'ai.feature.reviewSummaryEnabled': {
    key: 'ai.feature.reviewSummaryEnabled',
    schema: z.boolean(),
    default: false,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Enable the A9.3 review-summary feature (the business page shows an AI summary of recent reviews).',
  },
  'ai.feature.faqAutoAnswerEnabled': {
    key: 'ai.feature.faqAutoAnswerEnabled',
    schema: z.boolean(),
    default: false,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Enable the A9.4 FAQ auto-answer feature (a draft answer is generated for new questions the owner can publish with an AI label).',
  },
  'ai.feature.recommendationsEnabled': {
    key: 'ai.feature.recommendationsEnabled',
    schema: z.boolean(),
    default: false,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Enable the A9.5 personalized recommendation feature (the home page shows a «For You» section).',
  },
  'ai.feature.fraudToxicityEnabled': {
    key: 'ai.feature.fraudToxicityEnabled',
    schema: z.boolean(),
    default: false,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Enable the A9.6 fraud/toxicity score (a 0..1 score on each review for the moderation queue).',
  },
  // A9.3 — the editable prompt templates. The admin can edit the system
  // prompt the LLM driver gets (in Persian, with placeholders the service
  // fills). Bumping `version` invalidates every existing summary (the
  // service detects the version mismatch + regenerates on next read).
  'ai.prompts.reviewSummary.system': {
    key: 'ai.prompts.reviewSummary.system',
    schema: z.string().min(20).max(4000),
    default:
      'شما یک دستیار خلاصه‌ساز نظرات هستید. نظرات کاربران را خلاصه کنید: ' +
      'یک پاراگراف کوتاه (۲-۳ جمله) به فارسی، با ذکر تعداد نظرات، میانگین ' +
      'امتیاز، و نکات کلیدی مثبت و منفی. فقط از متن نظرات استفاده کنید؛ ' +
      'اطلاعات ساختگی نسازید. فارسی روان و محترمانه بنویسید.',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The system prompt sent to the LLM for the A9.3 review-summary feature. Editable by admins. Bumping ai.prompts.reviewSummary.version invalidates all existing summaries.',
  },
  'ai.prompts.reviewSummary.version': {
    key: 'ai.prompts.reviewSummary.version',
    schema: z.number().int().min(1).max(1000),
    default: 1,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The prompt-template version. Bumping this value marks every existing summary as stale (next read regenerates with the new prompt).',
  },
  'ai.prompts.reviewSummary.maxReviews': {
    key: 'ai.prompts.reviewSummary.maxReviews',
    schema: z.number().int().min(3).max(100),
    default: 30,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'Max number of recent approved reviews sent to the LLM in one prompt (newest first, capped to keep the prompt within token budget).',
  },
  // A9.4 — the FAQ-answer prompt templates. The admin can edit the system
  // prompt the LLM gets for drafting answers to user questions on the
  // business page.
  'ai.prompts.faqAnswer.system': {
    key: 'ai.prompts.faqAnswer.system',
    schema: z.string().min(20).max(4000),
    default:
      'شما دستیار پاسخ به پرسش‌های کاربران درباره کسب‌وکار هستید. یک پاسخ ' +
      'کوتاه (۱-۳ جمله) به فارسی، مودبانه و واقع‌بینانه بنویسید. اگر ' +
      'اطلاعات کافی ندارید، صادقانه بگویید. هیچ قیمت یا ساعاتی که در متن ' +
      'ورودی نباشد نسازید. در پایان یک جمله پیشنهاد دهید که کاربر برای ' +
      'اطلاعات بیشتر مستقیماً با کسب‌وکار تماس بگیرد.',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The system prompt sent to the LLM for the A9.4 FAQ auto-answer feature. Editable by admins. Bumping ai.prompts.faqAnswer.version invalidates all existing drafts.',
  },
  'ai.prompts.faqAnswer.version': {
    key: 'ai.prompts.faqAnswer.version',
    schema: z.number().int().min(1).max(1000),
    default: 1,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The prompt-template version for FAQ answers. Bumping marks every existing draft as stale.',
  },
  // A9.6 — the fraud/toxicity-score prompt template. The admin can edit
  // the system prompt the LLM gets for classifying reviews.
  'ai.prompts.fraudToxicity.system': {
    key: 'ai.prompts.fraudToxicity.system',
    schema: z.string().min(20).max(4000),
    default:
      'شما یک طبقه‌بند نظرات هستید. یک نمرهٔ تقلب/سمّی بودن بین ۰ تا ۱ ' +
      'به هر نظر بدهید (۰ = بی‌خطر، ۱ = پرخطر). فقط JSON برگردانید: ' +
      '{"score": 0.0, "signals": ["long_body", "all_caps", "blocked_word"]}. ' +
      'سیگنال‌های ممکن: long_body, all_caps, repeated_punctuation, blocked_word.',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The system prompt sent to the LLM for the A9.6 fraud/toxicity feature. Editable by admins. Bumping ai.prompts.fraudToxicity.version invalidates all existing scores.',
  },
  'ai.prompts.fraudToxicity.version': {
    key: 'ai.prompts.fraudToxicity.version',
    schema: z.number().int().min(1).max(1000),
    default: 1,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The prompt-template version for fraud scores. Bumping marks every existing score as stale.',
  },
  // A9.5 — the personalized-recommendation explanation prompt. The ranking
  // itself is rule-based (similarity math, no LLM); this prompt is only used
  // when a caller passes ?explain=true (one short Persian sentence explaining
  // why the page's top business was recommended). Bumping the version
  // invalidates cached explanations on the next request.
  'ai.prompts.recommendation.system': {
    key: 'ai.prompts.recommendation.system',
    schema: z.string().min(20).max(4000),
    default:
      'شما دستیار توضیح پیشنهادها هستید. با توجه به علایق کاربر (دسته‌ها و ' +
      'امکانات مورد علاقه) و کسب‌وکار پیشنهادشده، یک جمله کوتاه به فارسی ' +
      'بنویسید و توضیح دهید چرا این کسب‌وکار برای او پیشنهاد شده است. ' +
      'مودبانه، واقع‌بینانه و بدون اغراق. فقط یک جمله.',
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The system prompt sent to the LLM for the A9.5 recommendation explanation (only when ?explain=true). Editable by admins. The ranking itself is rule-based and needs no prompt.',
  },
  'ai.prompts.recommendation.version': {
    key: 'ai.prompts.recommendation.version',
    schema: z.number().int().min(1).max(1000),
    default: 1,
    group: 'ai',
    public: false,
    isSecret: false,
    description:
      'The prompt-template version for recommendation explanations. Bumping invalidates cached explanations on the next request.',
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
