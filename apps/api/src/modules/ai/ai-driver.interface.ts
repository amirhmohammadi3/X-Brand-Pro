import type { AiCompletionRequest, AiCompletionResult } from '@app/contracts';

/**
 * AI driver interface (A9.1). Every driver — fake (no network, canned
 * response), openai (OpenAI-compatible HTTP), rule (statistical, no model,
 * the A9.2 fallback) — implements this single method.
 *
 * Contract:
 *  - The driver MUST NOT throw on a transient failure (timeout, 5xx,
 *    network). It returns `{ ok: false, errorCode: 'AI_DRIVER_FAILED',
 *    errorMessage }` instead; the service decides whether to retry.
 *  - The driver MAY throw on a programmer error (malformed config that the
 *    service should have caught) — but the service wraps every call in a
 *    try/catch that downgrades even those to `AI_DRIVER_FAILED`, so the
 *    feature never sees a throw.
 *  - `latencyMs` is measured by the driver (the fetch wall-clock); the
 *    service adds the retry overhead on top.
 *  - `promptTokens` / `completionTokens` are the values the driver reports
 *    (the openai driver reads `usage` from the response body; the fake
 *    driver reports a fixed 0/0; the rule driver reports an estimate). The
 *    service debits these against the monthly budget.
 *  - `text` is the completion text (null on failure); the service truncates
 *    it to 200 chars before storing the log row.
 */
export interface AiDriver {
  /** Stable machine name — `fake` | `openai` | `rule` (mirrors the contract). */
  readonly name: 'fake' | 'openai' | 'rule';

  /**
   * Run a completion. NEVER throws on a driver-level failure; returns
   * `{ ok: false, errorCode, errorMessage }` instead.
   */
  complete(req: AiCompletionRequest): Promise<AiCompletionResult>;
}

/**
 * The shape of the resolved AI config (the service reads it once per call
 * from the settings service, then hands the relevant slice to each
 * driver). The driver does not read settings itself — the service is the
 * single chokepoint that knows the config + the budget + the log.
 */
export interface AiRuntimeConfig {
  /** The driver the service will call (after the feature-flag check). */
  driver: 'fake' | 'openai' | 'rule';
  /** The openai driver config (only used when driver === 'openai'). */
  openai: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  /** Per-call timeout (ms) — passed to AbortController. */
  timeoutMs: number;
  /** Retry count for transient failures. */
  maxRetries: number;
  /** Monthly token budget (0 = unlimited). */
  monthlyBudgetTokens: number;
  /** Current month spend (tokens) — read fresh per call. */
  monthlyUsedTokens: number;
  /** Per-feature enable flags (resolved from settings). */
  features: Record<
    'review_summary' | 'faq_auto_answer' | 'recommendation' | 'fraud_toxicity' | 'admin_test',
    boolean
  >;
}

/** The DI token for the AiDriver binding (the module picks the driver). */
export const AI_DRIVER = Symbol('AI_DRIVER');
