/**
 * Analytics dashboard helpers (F7.8) — pure functions to pivot the B7.2 stats
 * `series` (flat: one row per business-day × type) into the per-type time
 * arrays the charts consume, plus a funnel view derivation and range-label
 * formatting. No React, no DOM — fully unit-testable.
 *
 * The series from the API is already:
 *   - keyed by `YYYY-MM-DD` business-local (the API resolved the timezone);
 *   - zero-filled for every (day, type) the business has data for;
 *   - bounded to the requested `from`/`to` window (defaults: last 30 days).
 *
 * The dashboard's job is to:
 *   1. enumerate the full date range [from..to] (the API may omit a day with
 *      zero events across ALL types — the chart x-axis must still show it);
 *   2. pivot into one array per event type, indexed by date;
 *   3. compute the funnel (view → call → direction → share) from the totals.
 */
import { ANALYTICS_EVENT_TYPES, type AnalyticsStatsResult } from '@app/contracts';

/** A single day's counts across all event types (chart x-axis tick). */
export interface DayBucket {
  date: string; // YYYY-MM-DD
  counts: Record<string, number>; // keyed by AnalyticsEventType
}

/** The funnel order: view → call → direction → share. impression is separate. */
export const FUNNEL_ORDER = [
  'business_view',
  'call_click',
  'direction_click',
  'share_click',
] as const;

/**
 * Enumerate every `YYYY-MM-DD` day in [from..to] inclusive. The API bounds
 * the series; the chart x-axis must still render a day that had zero events
 * (the API omits such a row — the pivot fills it with 0).
 */
export function enumerateDays(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (start.getTime() > end.getTime()) return [];
  const cursor = new Date(start);
  // Hard cap to avoid a runaway loop on a bad range (the API caps at 365d).
  for (let i = 0; i < 366 && cursor.getTime() <= end.getTime(); i++) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Pivot the flat `series` into one `DayBucket` per calendar day in [from..to],
 * zero-filling missing (day, type) pairs. The result is sorted ascending by
 * date — the order the line chart draws left→right.
 */
export function pivotSeries(stats: AnalyticsStatsResult): DayBucket[] {
  const days = enumerateDays(stats.from, stats.to);
  if (days.length === 0) return [];
  const byDate = new Map<string, Record<string, number>>();
  for (const point of stats.series) {
    let bucket = byDate.get(point.date);
    if (!bucket) {
      bucket = {};
      byDate.set(point.date, bucket);
    }
    bucket[point.type] = (bucket[point.type] ?? 0) + point.count;
  }
  return days.map((date) => ({
    date,
    counts: byDate.get(date) ?? {},
  }));
}

/**
 * The funnel stages: each entry is the cumulative total for that event type
 * in the funnel order, plus the conversion rate from the previous stage
 * (the first stage's rate is 100%). impression is NOT a funnel stage.
 */
export interface FunnelStage {
  type: (typeof FUNNEL_ORDER)[number];
  total: number;
  /** Conversion from the previous stage (0..1); the first stage is 1. */
  conversionFromPrev: number;
  labelKey: string;
}

/**
 * Build the view → call → direction → share funnel from the stats totals.
 * Returns the stages in order; each carries its total + the conversion rate
 * from the previous stage (first stage = 1.0). An empty funnel (zero views)
 * returns an empty array — the dashboard renders the empty state.
 */
export function buildFunnel(
  stats: AnalyticsStatsResult,
  labelByKey: Record<(typeof FUNNEL_ORDER)[number], string>,
): FunnelStage[] {
  const stages = FUNNEL_ORDER.map((type) => ({
    type,
    total: stats.totals[type] ?? 0,
    labelKey: labelByKey[type],
  }));
  if (stages.length === 0) return [];
  const first = stages[0]!;
  const out: FunnelStage[] = [{ ...first, conversionFromPrev: 1 }];
  for (let i = 1; i < stages.length; i++) {
    const prev = out[i - 1]!;
    const cur = stages[i]!;
    const rate = prev.total > 0 ? cur.total / prev.total : 0;
    out.push({ ...cur, conversionFromPrev: rate });
  }
  return out;
}

/** A preset range the dashboard's range selector offers. */
export interface RangePreset {
  key: '7d' | '30d' | '90d';
  labelKey: string;
  /** Returns the {from, to} YYYY-MM-DD window for "the last N days incl today". */
  window: () => { from: string; to: string };
}

/** The range presets the dashboard offers (the API defaults to 30d).
 *  `labelKey` is relative to the `dashboard` namespace (the dashboard calls
 *  `t(labelKey)` under `useTranslations('dashboard')`). */
export const RANGE_PRESETS: ReadonlyArray<RangePreset> = [
  {
    key: '7d',
    labelKey: 'analytics.range.7d',
    window: () => rangeWindow(7),
  },
  {
    key: '30d',
    labelKey: 'analytics.range.30d',
    window: () => rangeWindow(30),
  },
  {
    key: '90d',
    labelKey: 'analytics.range.90d',
    window: () => rangeWindow(90),
  },
];

/** The last `days` days inclusive of today (business-local `YYYY-MM-DD`). */
export function rangeWindow(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** The single line-chart series (one per event type) the SVG chart renders. */
export interface ChartSeries {
  type: (typeof ANALYTICS_EVENT_TYPES)[number];
  label: string;
  points: Array<{ date: string; value: number }>;
  /** Max value across all points (0 when all empty) — for y-axis scaling. */
  max: number;
}

/**
 * Build one `ChartSeries` per event type from the pivoted buckets. Each
 * series carries its own max so the chart can scale independently OR share
 * a common max (the dashboard shares a common max for cross-type comparison).
 */
export function buildChartSeries(
  buckets: DayBucket[],
  labelsByType: Record<string, string>,
): ChartSeries[] {
  return ANALYTICS_EVENT_TYPES.map((type) => {
    const points = buckets.map((b) => ({ date: b.date, value: b.counts[type] ?? 0 }));
    const max = points.reduce((m, p) => Math.max(m, p.value), 0);
    return { type, label: labelsByType[type] ?? type, points, max };
  });
}

/** The shared max across all series (for a common y-axis scale). */
export function commonMax(series: ChartSeries[]): number {
  return series.reduce((m, s) => Math.max(m, s.max), 0);
}
