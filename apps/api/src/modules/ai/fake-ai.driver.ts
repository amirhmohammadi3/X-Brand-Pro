import { Injectable, Logger } from '@nestjs/common';
import type { AiCompletionRequest, AiCompletionResult } from '@app/contracts';
import type { AiDriver } from './ai-driver.interface.js';

/**
 * Fake AI driver (A9.1). Returns a deterministic canned response — used:
 *  - by the admin "test connection" button when no real driver is
 *    configured (so an admin can sanity-check the wiring);
 *  - by the test suite (no network, no flakiness, no cost).
 *
 * The driver estimates token usage as `ceil(charLength / 4)` — a rough
 * proxy (English ≈ 4 chars/token; Persian is denser so this is an
 * over-estimate, which errs toward budget safety). The fake driver never
 * fails: it is the only driver an unprovisioned install can call.
 */
@Injectable()
export class FakeAiDriver implements AiDriver {
  private readonly logger = new Logger(FakeAiDriver.name);
  readonly name = 'fake' as const;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const start = Date.now();
    // A deterministic, locale-aware canned response. The Persian greeting
    // is what the admin test button shows; the prompt echo lets the test
    // suite assert the wiring end-to-end.
    const promptText = req.messages.map((m) => m.content).join('\n');
    const completionText = `[fake-ai] سلام! این یک پاسخ آزمایشی است. (prompt length: ${promptText.length} chars)`;

    // Token estimate: char_length / 4 (a conservative over-estimate, so the
    // budget debits more than the real openai driver would — fails safe).
    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(completionText.length / 4);

    this.logger.debug(
      `fake complete: feature=${req.feature} promptTokens=${promptTokens} completionTokens=${completionTokens}`,
    );

    return {
      ok: true,
      driver: 'fake',
      model: null,
      text: completionText,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - start,
      errorCode: null,
      errorMessage: null,
    };
  }
}
