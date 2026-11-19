import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DrizzleClient } from '../../db/drizzle.client.js';
import { aiCalls, type AiCallRow, type NewAiCallRow } from '../../db/schema/ai.js';
import type { AiDriverName, AiErrorCode, AiFeature } from '@app/contracts';

/** DI token for the AI calls repository (tests bind a fake). */
export const AI_CALLS_REPOSITORY = Symbol('AI_CALLS_REPOSITORY');

/**
 * The narrow fake-able surface for the AI calls log: insert one row, list
 * paginated, and read the current month's spend. Kept small so the
 * in-memory fake in tests stays trivial.
 */
export interface AiCallsRepositoryLike {
  insert(row: NewAiCallRow): Promise<AiCallRow>;
  list(
    filters: { feature?: AiFeature; driver?: AiDriverName; ok?: boolean },
    limit: number,
    offset: number,
  ): Promise<{ rows: AiCallRow[]; total: number }>;
  /** Tokens used this calendar month by successful calls (the budget debit). */
  monthlySpend(now: Date): Promise<number>;
}

/**
 * Drizzle-backed AI calls repository (A9.1). One insert per driver call;
 * the list query drives the admin "AI calls" tab; the monthlySpend query
 * drives the budget gate (cached for 60s by the service to avoid hitting
 * the DB on every call).
 */
@Injectable()
export class AiCallsRepository implements AiCallsRepositoryLike {
  constructor(@Inject(DrizzleClient) private readonly drizzle: DrizzleClient) {}

  async insert(row: NewAiCallRow): Promise<AiCallRow> {
    const db = this.drizzle.db;
    const inserted = await db.insert(aiCalls).values(row).returning();
    if (inserted.length === 0) {
      throw new Error('ai_calls insert returned no row');
    }
    return inserted[0]!;
  }

  async list(
    filters: { feature?: AiFeature; driver?: AiDriverName; ok?: boolean },
    limit: number,
    offset: number,
  ): Promise<{ rows: AiCallRow[]; total: number }> {
    const db = this.drizzle.db;
    const conds = [];
    if (filters.feature) conds.push(eq(aiCalls.feature, filters.feature));
    if (filters.driver) conds.push(eq(aiCalls.driver, filters.driver));
    if (typeof filters.ok === 'boolean') conds.push(eq(aiCalls.ok, filters.ok));
    const where = conds.length === 0 ? undefined : and(...conds);

    const rows = await db
      .select()
      .from(aiCalls)
      .where(where)
      .orderBy(desc(aiCalls.createdAt), desc(aiCalls.id))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiCalls)
      .where(where);
    const total = totalRows[0]?.count ?? 0;
    return { rows, total };
  }

  async monthlySpend(now: Date): Promise<number> {
    const db = this.drizzle.db;
    // date_trunc('month', now()) — start of the current calendar month in
    // the DB's timezone (UTC). The budget resets on the 1st of each month.
    const monthStart = sql`date_trunc('month', ${now.toISOString()}::timestamptz)`;
    const rows = await db
      .select({
        total: sql<number>`COALESCE(SUM(${aiCalls.promptTokens} + ${aiCalls.completionTokens}), 0)::int`,
      })
      .from(aiCalls)
      .where(and(eq(aiCalls.ok, true), gte(aiCalls.createdAt, monthStart)));
    return rows[0]?.total ?? 0;
  }
}

/** Truncate a string to `max` chars (for the log excerpts). */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Helper: build the NewAiCallRow from a completion result + the prompt text. */
export function toCallLogRow(
  feature: AiFeature,
  result: {
    driver: AiDriverName;
    model: string | null;
    ok: boolean;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    errorCode: AiErrorCode | null;
    errorMessage: string | null;
    text: string | null;
  },
  promptExcerptSource: string,
): NewAiCallRow {
  return {
    feature,
    driver: result.driver,
    model: result.model,
    ok: result.ok,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    latencyMs: result.latencyMs,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    promptExcerpt: truncate(promptExcerptSource, 200),
    completionExcerpt: truncate(
      result.ok ? (result.text ?? '') : (result.errorMessage ?? 'unknown error'),
      200,
    ),
  };
}
