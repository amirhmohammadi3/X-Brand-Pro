'use client';

/**
 * Admin revenue API hooks (F8.4). The admin-facing aggregate read over
 * verified payments — the «درآمد» (Revenue) panel. The report covers a
 * `YYYY-MM-DD` window (defaults to the last 30 days); the range selector
 * refetches.
 */
import { useQuery } from '@tanstack/react-query';
import { revenueReportSchema, type RevenueReport } from '@app/contracts';
import { apiFetch } from './client';

/** `GET /billing/revenue?from=&to=` — the revenue report (admin-only). */
export function useRevenueReport(from?: string, to?: string): {
  report: RevenueReport | null;
  isPending: boolean;
  error: unknown;
} {
  const query = useQuery<RevenueReport>({
    queryKey: ['admin', 'revenue', from ?? 'default', to ?? 'default'],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const query = qs.toString();
      const { data } = await apiFetch(
        `/billing/revenue${query ? `?${query}` : ''}`,
        revenueReportSchema,
      );
      return data;
    },
  });
  return { report: query.data ?? null, isPending: query.isPending, error: query.error };
}
