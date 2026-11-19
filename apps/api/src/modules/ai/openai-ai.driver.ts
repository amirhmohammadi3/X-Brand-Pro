import { Injectable, Logger } from '@nestjs/common';
import type { AiCompletionRequest, AiCompletionResult } from '@app/contracts';
import type { AiDriver } from './ai-driver.interface.js';

/**
 * OpenAI-compatible chat-completions driver (A9.1).
 *
 * Works against:
 *  - openai.com — the canonical API (model `gpt-4o-mini`, `gpt-4o`, …);
 *  - OpenRouter — the same shape under a different baseUrl;
 *  - Ollama / LM Studio — a local `http://localhost:11434/v1` endpoint.
 *
 * Resilience rules (the prompt's hard requirements):
 *  - **Timeout**: an AbortController fires at `timeoutMs`; the fetch is
 *    aborted and the result is `AI_DRIVER_FAILED` (the service retries).
 *  - **Retry**: transient failures (timeout, network error, 5xx) are
 *    retried up to `maxRetries` times by the SERVICE (the driver runs ONE
 *    attempt; the service is the retry loop). A 4xx is not retried — the
 *    request is malformed (bad model, bad auth).
 *  - **Fail-soft**: the driver NEVER throws on a driver-level failure.
 *    It returns `{ ok: false, errorCode, errorMessage }`. A throw here
 *    would break the business page; the service wraps every call in a
 *    try/catch as a final safety net regardless.
 *  - **No credentials**: if `apiKey` is empty, returns
 *    `AI_NO_CREDENTIALS` without a network call.
 *  - **Invalid response**: if the body is not valid JSON or is missing
 *    `choices[0].message.content`, returns `AI_INVALID_RESPONSE`.
 *  - **Cost**: reads `usage.prompt_tokens` / `usage.completion_tokens`
 *    from the response body (every OpenAI-compatible server reports them).
 *    If the server omits `usage`, the driver estimates with char/4 (the
 *    fake driver's heuristic) so the budget still debits something.
 *
 * The driver is constructed WITHOUT config — the service passes the
 * resolved config (`baseUrl`, `apiKey`, `model`, `timeoutMs`) to each
 * `complete()` call via the `cfg` argument. This keeps the driver
 * stateless (an admin settings change takes effect on the next call
 * without re-instantiating the driver).
 */
export interface OpenAiDriverConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** The shape of the OpenAI chat-completions response we read. */
interface OpenAiCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

@Injectable()
export class OpenAiDriver implements AiDriver {
  private readonly logger = new Logger(OpenAiDriver.name);
  readonly name = 'openai' as const;

  /**
   * The config for the next call. Set by the service before each call (the
   * service resolves it from SettingsService so an admin change takes effect
   * without a restart). The driver is stateless beyond this single field —
   * the service is the single chokepoint that knows the config + the budget
   * + the log, and it sets this property right before invoking `complete()`.
   *
   * If `cfg` is null when `complete()` runs, the driver returns
   * `AI_NO_CREDENTIALS` (the service always sets cfg first, but the
   * defensive check guards against a misuse).
   */
  cfg: OpenAiDriverConfig | null = null;

  /**
   * Run one completion attempt. The service handles retries (linear
   * backoff, 250ms × attempt) — this method is a single fetch.
   */
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const start = Date.now();

    if (!this.cfg) {
      return {
        ok: false,
        driver: 'openai',
        model: null,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_NO_CREDENTIALS',
        errorMessage: 'OpenAiDriver.cfg was not set by the service before the call.',
      };
    }
    const cfg = this.cfg;

    // No credentials → AI_NO_CREDENTIALS (no network call).
    if (!cfg.apiKey) {
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_NO_CREDENTIALS',
        errorMessage: 'No API key configured (ai.openai.apiKey is empty).',
      };
    }

    // Build the chat/completions URL. baseUrl is already validated as a URL
    // by the settings registry schema; we only normalize the trailing slash.
    const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stream: false,
        }),
      });
    } catch (err) {
      // AbortError → timed out; other → network error. Both transient.
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_DRIVER_FAILED',
        errorMessage: aborted
          ? `Request timed out after ${cfg.timeoutMs}ms.`
          : `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      clearTimeout(timer);
    }

    // 4xx → permanent failure (bad model, bad auth, bad request). The
    // service does NOT retry these — they use a distinct code so the retry
    // loop can tell permanent from transient. (401 maps to NO_CREDENTIALS,
    // since that is the more specific reason; other 4xx → INVALID_RESPONSE
    // — the request was malformed so the response is unusable.)
    if (response.status === 401 || response.status === 403) {
      const errBody = await safeReadJson(response);
      const msg = errBody?.error?.message ?? `HTTP ${response.status} ${response.statusText}`;
      this.logger.warn(`openai ${response.status}: ${msg}`);
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_NO_CREDENTIALS',
        errorMessage: `HTTP ${response.status}: ${msg}`,
      };
    }
    if (response.status >= 400 && response.status < 500) {
      const errBody = await safeReadJson(response);
      const msg = errBody?.error?.message ?? `HTTP ${response.status} ${response.statusText}`;
      this.logger.warn(`openai 4xx: ${response.status} ${msg}`);
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_INVALID_RESPONSE',
        errorMessage: `HTTP ${response.status}: ${msg}`,
      };
    }

    // 5xx → transient; the service will retry.
    if (response.status >= 500) {
      this.logger.warn(`openai 5xx: ${response.status} ${response.statusText}`);
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_DRIVER_FAILED',
        errorMessage: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    // 2xx → parse the body.
    const body = await safeReadJson(response);
    if (!body) {
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_INVALID_RESPONSE',
        errorMessage: 'Response body was not valid JSON.',
      };
    }

    // Some servers return 200 + an `error` object on soft failures.
    if (body.error) {
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_DRIVER_FAILED',
        errorMessage: body.error.message ?? body.error.type ?? 'Unknown server error',
      };
    }

    const text = body.choices?.[0]?.message?.content ?? null;
    if (text === null || text === undefined) {
      return {
        ok: false,
        driver: 'openai',
        model: cfg.model,
        text: null,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - start,
        errorCode: 'AI_INVALID_RESPONSE',
        errorMessage: 'Response had no choices[0].message.content.',
      };
    }

    // Token usage: prefer the server-reported values; fall back to char/4.
    const promptTokens =
      body.usage?.prompt_tokens ??
      Math.ceil(req.messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
    const completionTokens = body.usage?.completion_tokens ?? Math.ceil(text.length / 4);

    return {
      ok: true,
      driver: 'openai',
      model: cfg.model,
      text,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - start,
      errorCode: null,
      errorMessage: null,
    };
  }
}

/** Read the response body as JSON, returning null on any parse error. */
async function safeReadJson(response: Response): Promise<OpenAiCompletionResponse | null> {
  try {
    return (await response.json()) as OpenAiCompletionResponse;
  } catch {
    return null;
  }
}
