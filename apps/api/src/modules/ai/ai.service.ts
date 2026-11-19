import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  AiCallRow,
  AiCallLogQuery,
  AiCallLogResult,
  AiCompletionRequest,
  AiCompletionResult,
  AiConfig,
  AiFeature,
  AiTestBody,
  AiTestResult,
} from '@app/contracts';
// SettingsService is constructor-injected: Nest reads its type at runtime from
// emitDecoratorMetadata, so it must stay a value import (do not "fix").
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsService } from '../settings/settings.service.js';
// CacheService is constructor-injected (global, no module import needed).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CacheService } from '../../redis/cache.service.js';
import {
  AI_CALLS_REPOSITORY,
  type AiCallsRepositoryLike,
  toCallLogRow,
} from './ai-calls.repository.js';
import { AI_DRIVER, type AiDriver } from './ai-driver.interface.js';
// The three concrete drivers are constructor-injected too (Nest reads their
// types at runtime via emitDecoratorMetadata), so they stay as value imports.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { FakeAiDriver } from './fake-ai.driver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OpenAiDriver, type OpenAiDriverConfig } from './openai-ai.driver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RuleAiDriver } from './rule-ai.driver.js';
import type { AiCallRow as AiCallDbRow } from '../../db/schema/ai.js';

/** The default page size for the admin call log endpoint. */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
/** Cache the monthly spend for 60s (avoids a SUM on every driver call). */
const SPEND_CACHE_TTL_SEC = 60;
/** Linear backoff between retries (ms × attempt). */
const RETRY_BACKOFF_MS = 250;

/**
 * AiService (A9.1) — the single orchestration layer for every AI feature.
 *
 * `complete(req)`:
 *   1. Resolve the config (driver, openai creds, timeout, retries, budget,
 *      per-feature flags) from SettingsService — through the cache, so an
 *      admin settings change takes effect on the next call.
 *   2. Feature gate: if `ai.enabled` is false OR the per-feature flag is
 *      false (admin_test is always allowed), return `AI_DISABLED`. The
 *      feature falls back to the rule driver if it has one (A9.2).
 *   3. Budget gate: if the current month's spend >= monthlyBudgetTokens
 *      (and budget > 0), return `AI_BUDGET_EXHAUSTED`. The feature falls
 *      back to the rule driver.
 *   4. Driver call: the chosen driver runs ONE attempt; on a transient
 *      failure (timeout, 5xx, network) the service retries up to
 *      `maxRetries` times with linear backoff. A 4xx / NO_CREDENTIALS /
 *      INVALID_RESPONSE is NOT retried.
 *   5. Fallback: if the LLM driver fails all attempts, the service chains
 *      to the rule driver (A9.2) — the feature always gets SOME answer.
 *      The log row records which driver actually answered.
 *   6. Log: insert one `ai_calls` row with the result + the prompt excerpt.
 *
 * `test(body, actor)` — the admin "test connection" endpoint. Sends a
 * canned prompt through the configured driver synchronously (NOT queued),
 * returns the result + the echoed prompt. The admin_test feature is
 * exempt from the feature-flag gate (so an admin can test before enabling).
 *
 * `getConfig()` — the admin-readable config (secrets masked).
 * `listCalls(query)` — the paginated call log.
 *
 * Fail-soft is the rule: a driver outage never throws to the caller; it
 * resolves to a rule-driver fallback or to `{ ok: false }`. The service
 * wraps EVERY driver call in a try/catch as the final safety net.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
    @Inject(AI_CALLS_REPOSITORY) private readonly callsRepo: AiCallsRepositoryLike,
    @Inject(AI_DRIVER) private readonly driver: AiDriver,
    /** The fake driver — used by the admin test button when no driver is set. */
    private readonly fakeDriver: FakeAiDriver,
    /** The openai driver — used when driver === 'openai'. */
    private readonly openaiDriver: OpenAiDriver,
    /** The rule driver — used as the automatic fallback. */
    private readonly ruleDriver: RuleAiDriver,
  ) {}

  /**
   * Run a completion. Fail-soft: never throws — returns `{ ok: false }`
   * on any failure and chains to the rule driver as a last resort.
   */
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const cfg = await this.resolveConfig();

    // Feature gate (admin_test bypasses the per-feature flag, but still
    // respects the global ai.enabled gate so a fully-off install never
    // spends tokens).
    if (!cfg.aiEnabled) {
      const result = await this.fallbackOrDisabled(req, cfg, 'AI_DISABLED');
      await this.logCall(req, cfg, result, result.driver === 'rule');
      return result;
    }
    if (req.feature !== 'admin_test' && !cfg.features[req.feature]) {
      const result = await this.fallbackOrDisabled(req, cfg, 'AI_DISABLED');
      await this.logCall(req, cfg, result, result.driver === 'rule');
      return result;
    }

    // Budget gate.
    if (cfg.monthlyBudgetTokens > 0 && cfg.monthlyUsedTokens >= cfg.monthlyBudgetTokens) {
      const result = await this.fallbackOrDisabled(req, cfg, 'AI_BUDGET_EXHAUSTED');
      await this.logCall(req, cfg, result, result.driver === 'rule');
      return result;
    }

    // Driver call with retry. The openai driver is the only one that may
    // fail transiently; the fake + rule drivers always succeed.
    const result = await this.callWithRetry(req, cfg);

    // Fallback to the rule driver on LLM failure.
    let finalResult = result;
    let usedFallback = false;
    if (!result.ok && cfg.driver !== 'rule' && cfg.driver !== 'fake') {
      this.logger.warn(
        `LLM driver ${cfg.driver} failed (code=${result.errorCode}); falling back to rule driver.`,
      );
      try {
        const fallback = await this.ruleDriver.complete(req);
        finalResult = fallback;
        usedFallback = true;
      } catch (err) {
        // Even the rule driver threw — return the original failure.
        this.logger.error(
          `rule driver fallback threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        finalResult = result;
      }
    }

    await this.logCall(req, cfg, finalResult, usedFallback);
    return finalResult;
  }

  /**
   * The admin "test connection" endpoint. Sends a canned prompt through
   * the configured driver synchronously (NOT queued), so an admin can
   * validate credentials from the panel. The admin_test feature is
   * exempt from the per-feature flag gate (so the admin can test before
   * enabling the feature) but respects the global `ai.enabled` gate
   * (so a fully-off install never spends tokens).
   */
  async test(body: AiTestBody): Promise<AiTestResult> {
    const prompt = body.prompt ?? 'در یک کلمه بگو سلام';
    const result = await this.complete({
      feature: 'admin_test',
      messages: [
        { role: 'system', content: 'You are a test endpoint. Reply briefly in Persian.' },
        { role: 'user', content: prompt },
      ],
      maxTokens: 64,
      temperature: 0,
    });
    return { ...result, prompt };
  }

  /** Admin-readable config (secrets masked). */
  async getConfig(): Promise<AiConfig> {
    const cfg = await this.resolveConfig();
    return {
      driver: cfg.driver,
      model: cfg.driver === 'openai' ? cfg.openai.model : null,
      baseUrl: cfg.driver === 'openai' ? cfg.openai.baseUrl : null,
      hasApiKey: cfg.driver === 'openai' && cfg.openai.apiKey.length > 0,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      monthlyBudgetTokens: cfg.monthlyBudgetTokens,
      monthlyUsedTokens: cfg.monthlyUsedTokens,
      features: cfg.features,
    };
  }

  /** Paginated call log (the admin "AI calls" tab). */
  async listCalls(query: AiCallLogQuery): Promise<AiCallLogResult> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;
    const { rows, total } = await this.callsRepo.list(
      { feature: query.feature, driver: query.driver, ok: query.ok },
      pageSize,
      offset,
    );
    return {
      items: rows.map(toCallRow),
      page,
      pageSize,
      total,
    };
  }

  // ─── internals ──────────────────────────────────────────────────────

  /**
   * Call the configured driver with retry. The retry loop is HERE (not in
   * the driver) so the retry count + backoff are admin-configurable via
   * `ai.maxRetries`. Transient = timeout / 5xx / network (errorCode
   * AI_DRIVER_FAILED); 4xx / NO_CREDENTIALS / INVALID_RESPONSE are NOT
   * retried.
   */
  private async callWithRetry(
    req: AiCompletionRequest,
    cfg: ResolvedConfig,
  ): Promise<AiCompletionResult> {
    if (cfg.driver === 'fake') {
      return this.safeCall(() => this.fakeDriver.complete(req), cfg, 'fake');
    }
    if (cfg.driver === 'rule') {
      return this.safeCall(() => this.ruleDriver.complete(req), cfg, 'rule');
    }
    // openai — retry loop.
    const openAiCfg: OpenAiDriverConfig = {
      baseUrl: cfg.openai.baseUrl,
      apiKey: cfg.openai.apiKey,
      model: cfg.openai.model,
      timeoutMs: cfg.timeoutMs,
    };
    // Set the driver's cfg for THIS call (the service re-reads settings on
    // every call so an admin change takes effect without a restart).
    this.openaiDriver.cfg = openAiCfg;
    let lastResult: AiCompletionResult | null = null;
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      const result = await this.safeCall(() => this.openaiDriver.complete(req), cfg, 'openai');
      lastResult = result;
      // Success or permanent failure → stop.
      if (result.ok) return result;
      if (result.errorCode !== 'AI_DRIVER_FAILED') return result;
      // Transient failure → retry (with backoff) unless this was the last.
      if (attempt < cfg.maxRetries) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
      }
    }
    return lastResult!;
  }

  /**
   * Wrap a driver call in a try/catch as the final safety net — a buggy
   * driver that throws (instead of returning `{ ok: false }`) is
   * downgraded to AI_DRIVER_FAILED so the feature never sees a throw.
   */
  private async safeCall(
    fn: () => Promise<AiCompletionResult>,
    cfg: ResolvedConfig,
    driverName: 'fake' | 'openai' | 'rule',
  ): Promise<AiCompletionResult> {
    const start = Date.now();
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`driver ${driverName} threw: ${msg}`);
      return {
        ok: false,
        driver: driverName,
        model: driverName === 'openai' ? cfg.openai.model : null,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_DRIVER_FAILED',
        errorMessage: `Driver threw: ${msg}`,
      };
    }
  }

  /**
   * Feature-disabled or budget-exhausted: chain to the rule driver so the
   * feature gets SOME answer (the rule driver never fails). If the rule
   * driver is the configured one already, the result is the disabled
   * error directly (no point calling rule twice).
   */
  private async fallbackOrDisabled(
    req: AiCompletionRequest,
    cfg: ResolvedConfig,
    errorCode: 'AI_DISABLED' | 'AI_BUDGET_EXHAUSTED',
  ): Promise<AiCompletionResult> {
    // Always run the rule fallback for the review_summary + fraud_toxicity
    // features (they have a meaningful rule output). For the others
    // (faq_auto_answer, recommendation, admin_test) the rule output is a
    // canned string — only the disabled result is meaningful.
    if (req.feature === 'review_summary' || req.feature === 'fraud_toxicity') {
      try {
        return await this.ruleDriver.complete(req);
      } catch {
        // fall through to the disabled result
      }
    }
    return {
      ok: false,
      driver: cfg.driver,
      model: cfg.driver === 'openai' ? cfg.openai.model : null,
      text: null,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      errorCode,
      errorMessage:
        errorCode === 'AI_DISABLED' ? 'AI feature is disabled.' : 'Monthly token budget exhausted.',
    };
  }

  /** Insert one ai_calls row (fail-soft — a log failure never breaks the call). */
  private async logCall(
    req: AiCompletionRequest,
    cfg: ResolvedConfig,
    result: AiCompletionResult,
    _usedFallback: boolean,
  ): Promise<void> {
    const promptExcerpt = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    try {
      await this.callsRepo.insert(toCallLogRow(req.feature, result, promptExcerpt));
    } catch (err) {
      // Logging is best-effort: a log write failure never breaks the call.
      this.logger.error(
        `failed to log ai_calls row: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Resolve the AI config from settings (through the SettingsService
   * cache, so a settings change takes effect on the next call without a
   * restart). Reads the monthly spend through the CacheService (60s TTL)
   * so the budget gate is fast.
   */
  private async resolveConfig(): Promise<ResolvedConfig> {
    const [
      aiEnabled,
      driver,
      baseUrl,
      apiKey,
      model,
      timeoutMs,
      maxRetries,
      monthlyBudgetTokens,
      reviewSummary,
      faqAutoAnswer,
      recommendations,
      fraudToxicity,
    ] = await Promise.all([
      this.settings.get<boolean>('ai.enabled'),
      this.settings.get<'fake' | 'openai' | 'rule'>('ai.driver'),
      this.settings.get<string>('ai.openai.baseUrl'),
      this.settings.get<string>('ai.openai.apiKey'),
      this.settings.get<string>('ai.openai.model'),
      this.settings.get<number>('ai.timeoutMs'),
      this.settings.get<number>('ai.maxRetries'),
      this.settings.get<number>('ai.monthlyBudgetTokens'),
      this.settings.get<boolean>('ai.feature.reviewSummaryEnabled'),
      this.settings.get<boolean>('ai.feature.faqAutoAnswerEnabled'),
      this.settings.get<boolean>('ai.feature.recommendationsEnabled'),
      this.settings.get<boolean>('ai.feature.fraudToxicityEnabled'),
    ]);

    const monthlyUsedTokens = await this.readMonthlySpend();

    return {
      aiEnabled,
      driver,
      openai: { baseUrl, apiKey, model },
      timeoutMs,
      maxRetries,
      monthlyBudgetTokens,
      monthlyUsedTokens,
      features: {
        review_summary: reviewSummary,
        faq_auto_answer: faqAutoAnswer,
        recommendation: recommendations,
        fraud_toxicity: fraudToxicity,
        admin_test: true,
      },
    };
  }

  /** Cached monthly spend (60s TTL). */
  private async readMonthlySpend(): Promise<number> {
    const key = 'ai:monthly-spend';
    const cached = await this.cache.get<number>(key);
    if (cached !== null) return cached;
    const spend = await this.callsRepo.monthlySpend(new Date());
    await this.cache.set(key, spend, SPEND_CACHE_TTL_SEC);
    return spend;
  }
}

/** Internal resolved config (the openai creds only meaningful on openai). */
interface ResolvedConfig {
  aiEnabled: boolean;
  driver: 'fake' | 'openai' | 'rule';
  openai: { baseUrl: string; apiKey: string; model: string };
  timeoutMs: number;
  maxRetries: number;
  monthlyBudgetTokens: number;
  monthlyUsedTokens: number;
  features: Record<AiFeature, boolean>;
}

/** Convert a row to the wire AiCallRow (id → string, dates → ISO). */
function toCallRow(row: AiCallDbRow): AiCallRow {
  return {
    id: row.id,
    feature: row.feature,
    driver: row.driver,
    model: row.model,
    ok: row.ok,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    promptExcerpt: row.promptExcerpt,
    completionExcerpt: row.completionExcerpt,
    createdAt: row.createdAt.toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
