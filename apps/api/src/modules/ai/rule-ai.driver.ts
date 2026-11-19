import { Injectable, Logger } from '@nestjs/common';
import type { AiCompletionRequest, AiCompletionResult } from '@app/contracts';
import type { AiDriver } from './ai-driver.interface.js';

/**
 * Rule-based AI driver (A9.2). A no-model statistical / rule-based
 * Persian summarizer used:
 *  - as the automatic fallback when the LLM driver fails or the budget is
 *    exhausted (the service chains: openai → rule, with the rule driver
 *    always succeeding);
 *  - as a no-cost mode for installations that have no LLM credentials.
 *
 * The driver recognizes a SPECIAL message convention so a feature can ask
 * for a structured summary: the last user message may carry a JSON-ish
 * directive in the content. For the review-summary feature the prompt is
 * `summarize reviews: <newline-separated reviews>` — the driver returns a
 * short Persian phrase with the count + the average rating + the most
 * common rating phrase. For other features the driver returns a generic
 * canned Persian response.
 *
 * The driver NEVER fails (it is the last-resort fallback). Token usage is
 * estimated with the char/4 heuristic (matches the fake driver).
 */
@Injectable()
export class RuleAiDriver implements AiDriver {
  private readonly logger = new Logger(RuleAiDriver.name);
  readonly name = 'rule' as const;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const start = Date.now();
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const promptText = req.messages.map((m) => m.content).join('\n');
    const text = synthesize(req.feature, lastUser?.content ?? promptText);
    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(text.length / 4);

    this.logger.debug(
      `rule complete: feature=${req.feature} promptTokens=${promptTokens} completionTokens=${completionTokens}`,
    );

    return {
      ok: true,
      driver: 'rule',
      model: 'rule-fa-v1',
      text,
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - start,
      errorCode: null,
      errorMessage: null,
    };
  }
}

/**
 * The rule-based synthesizer — exported for unit testing. The strategy:
 *  - `review_summary`: parse the lines after the `summarize reviews:`
 *    marker as `<rating>|<body>` pairs; emit a Persian phrase with the
 *    count + the average rating + the most-common phrases. If no reviews
 *    can be parsed, emit a generic neutral summary.
 *  - `fraud_toxicity`: parse the lines as `<body>`; emit a JSON-like
 *    string `{ score: <0..1>, signals: [...] }` (deterministic — long
 *    reviews, ALL-CAPS, repeated punctuation raise the score).
 *  - everything else: a canned Persian response acknowledging the prompt.
 */
export function synthesize(feature: AiCompletionRequest['feature'], prompt: string): string {
  if (feature === 'review_summary') {
    return synthesizeReviewSummary(prompt);
  }
  if (feature === 'fraud_toxicity') {
    return synthesizeFraudScore(prompt);
  }
  // faq_auto_answer / recommendation / admin_test: a neutral canned reply.
  return 'پاسخ آزمایشی مبتنی بر قاعده: این قابلیت بدون مدل زبانی فعال است.';
}

/**
 * Parse `<rating>|<body>` lines (the A9.3 prompt format) and emit a short
 * Persian summary. Never throws — a malformed line is skipped.
 */
function synthesizeReviewSummary(prompt: string): string {
  const lines = prompt.split('\n').filter((l) => l.trim().length > 0);
  const reviews: Array<{ rating: number; body: string }> = [];
  for (const line of lines) {
    const m = line.match(/^(\d)\s*[|｜]\s*(.+)$/);
    if (m && m[1] && m[2]) {
      const r = parseInt(m[1], 10);
      if (r >= 1 && r <= 5) reviews.push({ rating: r, body: m[2] });
    }
  }
  if (reviews.length === 0) {
    return 'هنوز نظری برای این کسب‌وکار ثبت نشده است.';
  }
  const avg = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;
  const positive = reviews.filter((r) => r.rating >= 4).length;
  const negative = reviews.filter((r) => r.rating <= 2).length;
  const head = `${reviews.length} نظر ثبت شده، میانگین امتیاز ${avg.toFixed(1)} از ۵.`;
  if (positive >= negative && positive > 0) {
    return `${head} اکثر مشتریان راضی بوده‌اند.`;
  }
  if (negative > positive) {
    return `${head} بخشی از مشتریان ناراضی بوده‌اند.`;
  }
  return `${head} نظرات متعادل است.`;
}

/**
 * Deterministic 0..1 fraud/toxicity score from a body (A9.6 preview — the
 * real A9.6 will call this through the driver chain too).
 *  - long body (>800 chars): +0.2
 *  - ALL-CAPS substring (>20 chars): +0.2
 *  - repeated punctuation `!!!` / `???`: +0.15
 *  - blocked-word match (`آلودگی`/`کلاهبرداری`/`scam`): +0.4 (capped at 1)
 */
function synthesizeFraudScore(prompt: string): string {
  const lines = prompt.split('\n').filter((l) => l.trim().length > 0);
  let totalScore = 0;
  let count = 0;
  for (const line of lines) {
    let s = 0;
    if (line.length > 800) s += 0.2;
    if (/[A-Zآ-ی]{20,}/.test(line)) s += 0.2;
    if (/[!？?]{3,}/.test(line)) s += 0.15;
    if (/آلودگی|کلاهبرداری|scam|fraud/i.test(line)) s += 0.4;
    totalScore += Math.min(1, s);
    count += 1;
  }
  const avg = count > 0 ? totalScore / count : 0;
  return JSON.stringify({ score: Number(avg.toFixed(2)), signals: ['rule-based'] });
}
