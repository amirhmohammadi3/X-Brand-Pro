import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizePersianText, normalizeDigits } from '@app/contracts';
import type {
  ClearSearchHistoryResult,
  PopularQueriesQuery,
  PopularQueriesResult,
  SearchHistoryQuery,
  SearchHistoryResult,
  SearchRecordInput,
} from '@app/contracts';
// SearchStatsRepository is constructor-injected: Nest reads its type at runtime
// via emitDecoratorMetadata, so it must stay a value import (do not "fix" to
// `import type`).
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SearchStatsRepository } from './search-stats.repository.js';

/** Per-user history cap. Every recorded search prunes the user's rows beyond
 * the newest 20 — history is a "recent searches" list, not an archive. */
export const HISTORY_LIMIT = 20;

function notFoundException(id: string): NotFoundException {
  return new NotFoundException({
    code: 'NOT_FOUND' as const,
    messageKey: 'errors.not_found',
    message: `search history entry ${id} not found`,
    details: { entity: 'search history entry', id },
  });
}

/**
 * Search-stats service (B3.5) — one service for the write side (recording) and
 * the two read sides (history, popular).
 *
 * Recording (`record`, called from the B3.2 search controller after every
 * text search):
 * - `text` is canonicalised with `normalizePersianText` + `normalizeDigits`
 *   (DECISIONS B3.1/3.2) before dedupe/upsert, so Arabic-spelled and
 *   Persian-spelled duplicates are the same counter row / history entry;
 *   empty-after-normalisation input is a no-op.
 * - popularity is bumped for EVERY searcher (anonymous included) — no user
 *   identity is stored in `search_queries`.
 * - history is upserted only when `userId` is present, then pruned to the
 *   newest `HISTORY_LIMIT` rows.
 *
 * Recording failures never break the search: the controller wraps `record`
 * in a try/catch that swallows (a failed stats write must not turn a 200
 * search into a 500).
 */
@Injectable()
export class SearchStatsService {
  constructor(private readonly repo: SearchStatsRepository) {}

  async record(input: SearchRecordInput): Promise<void> {
    const normalized = normalizePersianText(normalizeDigits(input.text)).trim();
    if (normalized.length === 0) return;

    await this.repo.upsertPopular({
      normalizedText: normalized,
      text: input.text.trim(),
      cityId: input.cityId,
      resultCount: input.resultCount,
    });

    if (input.userId) {
      await this.repo.upsertHistory({
        userId: input.userId,
        normalizedText: normalized,
        text: input.text.trim(),
        cityId: input.cityId,
      });
      await this.repo.pruneHistory(input.userId, HISTORY_LIMIT);
    }
  }

  async history(userId: string, query: SearchHistoryQuery): Promise<SearchHistoryResult> {
    const rows = await this.repo.listHistory(userId, query.limit);
    return {
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        cityId: r.cityId,
        cityName: r.cityName ?? null,
        searchedAt: r.searchedAt.toISOString(),
      })),
    };
  }

  async clear(userId: string): Promise<ClearSearchHistoryResult> {
    return { deleted: await this.repo.clearHistory(userId) };
  }

  async remove(userId: string, id: string): Promise<{ deleted: 1 }> {
    const ok = await this.repo.removeHistoryItem(userId, id);
    if (!ok) throw notFoundException(id);
    return { deleted: 1 };
  }

  async popular(query: PopularQueriesQuery): Promise<PopularQueriesResult> {
    const rows = await this.repo.listPopular(query.cityId, query.limit);
    return {
      items: rows.map((r) => ({
        text: r.text,
        cityId: r.cityId,
        cityName: r.cityName ?? null,
        hits: r.hits,
        lastSearchedAt: r.lastSearchedAt.toISOString(),
      })),
    };
  }
}
