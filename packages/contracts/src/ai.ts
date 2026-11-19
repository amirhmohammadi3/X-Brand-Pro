import { z } from 'zod';
import { uuidSchema } from './primitives.js';

/**
 * AI contracts (Phase 9). The driver abstraction (interface + the fake +
 * OpenAI-compatible drivers live in the API; the contracts are the WIRE
 * shapes the API + the web app agree on).
 *
 * Design:
 *  - `AiCompletion` is the request shape every feature (review summary, FAQ
 *    auto-answer, recommendation rationale, fraud/toxicity score) sends.
 *  - `AiCompletionResult` is the response shape every driver returns.
 *  - `AiDriverName` enumerates the drivers the API ships — the contract
 *    stays open (`z.string()`) so an admin can add a new driver id without
 *    a release; the schema only constrains the known set.
 *  - Money/cost is tracked in whole tokens (input + output + total) — never
 *    in dollars; the budget cap is `ai.monthlyBudgetTokens` in the settings
 *    registry (A9.1).
 *  - Every call is logged to `ai_calls` (the row carries the feature, the
 *    driver, the model, the token counts, the latency, the success flag
 *    and a redacted-truncated prompt+completion). A9.7 surfaces those rows
 *    in the admin panel.
 *
 * Fail-soft is the rule: a driver outage never throws to the caller; it
 * resolves to `{ ok: false, errorCode: 'AI_DRIVER_FAILED' }` so the
 * feature can fall back to a rule-based driver (A9.2) or simply omit the
 * AI block. A 500 here would break the business page, which is the one
 * place it must never break.
 */

/**
 * The drivers the API ships (A9.1). `fake` is always available (returns a
 * deterministic canned response — used by tests and by the admin "test"
 * button when no credentials are configured); `openai` is the
 * OpenAI-compatible HTTP driver (works against openai.com, OpenRouter,
 * localhost:11434/v1 for Ollama, etc.); `rule` is the no-model driver
 * from A9.2 (statistical/rule-based Persian summaries — used as the
 * automatic fallback when the LLM driver fails or when the budget is
 * exhausted).
 */
export const AI_DRIVER_NAMES = ['fake', 'openai', 'rule'] as const;
export type AiDriverName = (typeof AI_DRIVER_NAMES)[number];

/**
 * The features that may call the driver. Each one is gated by its own
 * settings flag (`ai.<feature>Enabled`) AND the global `ai.enabled`; the
 * feature name is also the discriminator on the `ai_calls` log row so the
 * admin panel can break down cost per feature.
 */
export const AI_FEATURES = [
  'review_summary',
  'faq_auto_answer',
  'recommendation',
  'fraud_toxicity',
  'admin_test',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/**
 * A message in a completion request — the OpenAI `chat/completions` shape
 * (system / user / assistant turns). The driver is free to flatten it for
 * a non-chat backend; the wire format is the same so a feature never has
 * to know which driver is configured.
 */
export const aiMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(20_000),
  })
  .strict();
export type AiMessage = z.infer<typeof aiMessageSchema>;

/**
 * A completion request (the shape `AiService.complete()` accepts).
 * The feature labels the call for the log + the budget cap; the messages
 * are the prompt; `maxTokens` is the per-call ceiling (the driver clamps
 * to the model's actual max if lower); `temperature` defaults to 0.2
 * (deterministic-leaning; the features are summarization / classification,
 * not creative writing).
 */
export const aiCompletionRequestSchema = z
  .object({
    feature: z.enum(AI_FEATURES),
    messages: z.array(aiMessageSchema).min(1).max(20),
    maxTokens: z.number().int().min(1).max(8192).default(512),
    temperature: z.number().min(0).max(2).default(0.2),
  })
  .strict();
export type AiCompletionRequest = z.infer<typeof aiCompletionRequestSchema>;

/** Error codes a driver result may carry (the API maps them to HTTP). */
export const AI_ERROR_CODES = [
  'AI_DISABLED', // the feature flag or the global flag is off
  'AI_BUDGET_EXHAUSTED', // the monthly token budget is spent
  'AI_DRIVER_FAILED', // the driver call failed (timeout, 4xx/5xx, network)
  'AI_INVALID_RESPONSE', // the driver returned a malformed response
  'AI_NO_CREDENTIALS', // the openai driver has no apiKey configured
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * The completion result. `ok: true` carries the text + the token counts
 * (the API uses them to debit the monthly budget); `ok: false` carries an
 * error code + message (never throws to the caller).
 */
export const aiCompletionResultSchema = z
  .object({
    ok: z.boolean(),
    /** The driver that actually answered (the rule driver on fallback). */
    driver: z.enum(AI_DRIVER_NAMES),
    /** The model id the driver used (e.g. `gpt-4o-mini`, `rule-fa-v1`). */
    model: z.string().nullable(),
    text: z.string().nullable(),
    /** Tokens debited against the monthly budget (0 when ok:false). */
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    /** Wall-clock latency in ms (for the log + the admin panel). */
    latencyMs: z.number().int().min(0),
    /** Present when ok:false — the caller branches on this. */
    errorCode: z.enum(AI_ERROR_CODES).nullable(),
    errorMessage: z.string().nullable(),
  })
  .strict();
export type AiCompletionResult = z.infer<typeof aiCompletionResultSchema>;

/**
 * POST /admin/ai/test — the admin "test connection" button. Sends a
 * fixed prompt through the CURRENTLY configured driver (synchronously, not
 * queued) so an admin can validate credentials from the panel. The body is
 * optional (an empty body sends the canned test prompt).
 */
export const aiTestBodySchema = z
  .object({
    /** Optional override prompt (defaults to "در یک کلمه بگو سلام"). */
    prompt: z.string().min(1).max(500).optional(),
  })
  .strict();
export type AiTestBody = z.infer<typeof aiTestBodySchema>;

/** The test result — the same shape as a completion result, plus the echo. */
export const aiTestResultSchema = aiCompletionResultSchema
  .extend({
    prompt: z.string(),
  })
  .strict();
export type AiTestResult = z.infer<typeof aiTestResultSchema>;

/**
 * GET /admin/ai/config — the admin-readable AI config (the settings
 * registry keys with secrets masked, plus the live resolved flags +
 * the current month's spend). Read-only; the admin edits through the
 * generic PUT /admin/settings/:key endpoint (A9.7).
 */
export const aiConfigSchema = z
  .object({
    /** The resolved driver (after the feature-flag + credential checks). */
    driver: z.enum(AI_DRIVER_NAMES),
    /** The model id (or null on the fake/rule driver). */
    model: z.string().nullable(),
    /** The base URL the openai driver will call. */
    baseUrl: z.string().url().nullable(),
    /** Whether the apiKey is set (the value itself is never returned). */
    hasApiKey: z.boolean(),
    /** The per-call timeout (ms). */
    timeoutMs: z.number().int().min(1000).max(120_000),
    /** The retry count (linear backoff; 0 = no retry). */
    maxRetries: z.number().int().min(0).max(5),
    /** The monthly token budget (the cap). */
    monthlyBudgetTokens: z.number().int().min(0).max(1_000_000_000),
    /** The current month's spend (tokens used so far this calendar month). */
    monthlyUsedTokens: z.number().int().min(0),
    /** The per-feature enable flags (resolved from settings). */
    features: z.record(z.enum(AI_FEATURES), z.boolean()),
  })
  .strict();
export type AiConfig = z.infer<typeof aiConfigSchema>;

/**
 * GET /admin/ai/calls — the recent call log (paginated, newest first).
 * The admin "AI calls" tab in the panel; one row per `ai_calls` row.
 */
export const aiCallLogQuerySchema = z
  .object({
    feature: z.enum(AI_FEATURES).optional(),
    driver: z.enum(AI_DRIVER_NAMES).optional(),
    ok: z.boolean().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type AiCallLogQuery = z.infer<typeof aiCallLogQuerySchema>;

/** One row in the call log. */
export const aiCallRowSchema = z
  .object({
    id: z.string().uuid(),
    feature: z.enum(AI_FEATURES),
    driver: z.enum(AI_DRIVER_NAMES),
    model: z.string().nullable(),
    ok: z.boolean(),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    latencyMs: z.number().int().min(0),
    errorCode: z.enum(AI_ERROR_CODES).nullable(),
    /** The first 200 chars of the prompt (for context; never the full text). */
    promptExcerpt: z.string(),
    /** The first 200 chars of the completion (or the error message). */
    completionExcerpt: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AiCallRow = z.infer<typeof aiCallRowSchema>;

/** The paginated response (the standard envelope the rest of the API uses). */
export const aiCallLogResultSchema = z
  .object({
    items: z.array(aiCallRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();
export type AiCallLogResult = z.infer<typeof aiCallLogResultSchema>;

// ─── A9.3 — Review summary ──────────────────────────────────────────────

/**
 * A business's AI-generated review summary (A9.3). One row per business;
 * regenerated (debounced) on review changes + on admin demand + on
 * prompt-version bump. The summary is ALWAYS available — a stale flag tells
 * the page to show the previous text while the regenerate job runs (the
 * page is never empty, never blocked).
 */
export const aiReviewSummarySchema = z
  .object({
    businessId: uuidSchema,
    /** The summary text (Persian, 2-3 sentences). Null only on the very first read before the first job completes. */
    summary: z.string().nullable(),
    /** The driver that actually answered (fake / openai / rule). */
    driver: z.enum(AI_DRIVER_NAMES),
    /** The model id (rule-fa-v1 / gpt-4o-mini / null on fake). */
    model: z.string().nullable(),
    /** The prompt version that produced this summary (matches ai.prompts.reviewSummary.version). */
    promptVersion: z.number().int().min(1),
    /** True when a review changed but the regenerate job has not completed. The page shows the stale summary + a "regenerating" hint. */
    stale: z.boolean(),
    /** Tokens used by the last successful generation (for the cost display). */
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    /** Review snapshot at the last generation (count + average rating). */
    reviewCount: z.number().int().min(0),
    reviewAvgRating: z.number().min(0).max(5).nullable(),
    /** The last error code (null on success). */
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AiReviewSummary = z.infer<typeof aiReviewSummarySchema>;

/** GET /businesses/:id/ai-summary — public (cached 60s on the API side). */
export const aiReviewSummaryQuerySchema = z
  .object({
    /** If true, the endpoint waits up to 5s for the regenerate job to finish (used by the page's soft-refresh). Default false. */
    wait: z.coerce.boolean().optional(),
  })
  .strict();
export type AiReviewSummaryQuery = z.infer<typeof aiReviewSummaryQuerySchema>;

/** POST /admin/businesses/:id/ai-summary/regenerate — owner + admin only. */
export const aiReviewSummaryRegenerateResultSchema = z
  .object({
    enqueued: z.boolean(),
    /** The job id (BullMQ), null when the request was deduped within the debounce window. */
    jobId: z.string().nullable(),
  })
  .strict();
export type AiReviewSummaryRegenerateResult = z.infer<typeof aiReviewSummaryRegenerateResultSchema>;

/** GET /admin/businesses/:id/ai-summary — the admin/owner-only full read (includes the prompt version + last_error). */
export const aiReviewSummaryAdminSchema = aiReviewSummarySchema;
export type AiReviewSummaryAdmin = z.infer<typeof aiReviewSummaryAdminSchema>;

// ─── A9.4 — AI FAQ answers ──────────────────────────────────────────────

/**
 * An AI draft answer to a business question (A9.4). One row per question;
 * the owner can publish (creates a business_answer with the AI text + the
 * aiGenerated label) or dismiss. The draft is generated automatically
 * when a question is created, and regenerated when the question is edited
 * or the prompt version bumps.
 */
export const aiFaqAnswerSchema = z
  .object({
    questionId: uuidSchema,
    /** The AI draft text (Persian). Null only between row create + first generation. */
    draft: z.string().nullable(),
    /** The driver that produced the draft. */
    driver: z.enum(AI_DRIVER_NAMES),
    /** The model id. */
    model: z.string().nullable(),
    /** The prompt version. */
    promptVersion: z.number().int().min(1),
    /** True when the owner has published the draft as a business_answer. */
    published: z.boolean(),
    /** True when the owner dismissed the draft. */
    dismissed: z.boolean(),
    /** True when a regenerate is pending. */
    stale: z.boolean(),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AiFaqAnswer = z.infer<typeof aiFaqAnswerSchema>;

/** GET /businesses/:id/questions/:qid/ai-draft — owner + admin only. */
export const aiFaqDraftResultSchema = z
  .object({
    draft: aiFaqAnswerSchema.nullable(),
  })
  .strict();
export type AiFaqDraftResult = z.infer<typeof aiFaqDraftResultSchema>;

/** POST /businesses/:id/questions/:qid/ai-draft/publish — owner publishes the AI draft as the question's answer. */
export const aiFaqPublishResultSchema = z
  .object({
    /** The business_answer id created (or the existing one if already published). */
    answerId: uuidSchema,
    /** The published text (the AI draft). */
    text: z.string(),
    /** True if this publish created a new answer; false if it was already published. */
    created: z.boolean(),
  })
  .strict();
export type AiFaqPublishResult = z.infer<typeof aiFaqPublishResultSchema>;

/** POST /businesses/:id/questions/:qid/ai-draft/dismiss — owner hides the draft (regenerate-on-demand only). */
export const aiFaqDismissResultSchema = z
  .object({
    dismissed: z.boolean(),
  })
  .strict();
export type AiFaqDismissResult = z.infer<typeof aiFaqDismissResultSchema>;

/** POST /admin/businesses/:id/questions/:qid/ai-draft/regenerate — admin forces a regenerate. */
export const aiFaqRegenerateResultSchema = z
  .object({
    enqueued: z.boolean(),
    jobId: z.string().nullable(),
  })
  .strict();
export type AiFaqRegenerateResult = z.infer<typeof aiFaqRegenerateResultSchema>;
