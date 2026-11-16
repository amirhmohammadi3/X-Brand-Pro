/**
 * F7.8 analytics pivot/funnel helpers — pure functions, no React.
 *
 * Covers:
 *  - enumerateDays: inclusive range, empty on inverted/bad input, UTC-safe;
 *  - pivotSeries: zero-fills missing (day, type) pairs, sorts ascending;
 *  - buildFunnel: conversion rates from the previous stage (first = 1.0);
 *  - buildChartSeries + commonMax: per-type max + the shared max;
 *  - rangeWindow: last N days incl today, YYYY-MM-DD.
 */
import { describe, expect, it } from 'vitest';
import {
  buildChartSeries,
  buildFunnel,
  commonMax,
  enumerateDays,
  pivotSeries,
  rangeWindow,
  type DayBucket,
} from '../../src/lib/analytics/pivot';
import type { AnalyticsStatsResult } from '@app/contracts';

function makeStats(overrides: Partial<AnalyticsStatsResult> = {}): AnalyticsStatsResult {
  return {
    businessId: '00000000-0000-4000-8000-000000000001',
    from: '2026-11-01',
    to: '2026-11-03',
    series: [],
    totals: {
      business_view: 0,
      call_click: 0,
      direction_click: 0,
      share_click: 0,
      impression: 0,
    },
    ...overrides,
  };
}

const FUNNEL_LABELS = {
  business_view: 'Views',
  call_click: 'Calls',
  direction_click: 'Directions',
  share_click: 'Shares',
} as const;

describe('enumerateDays', () => {
  it('lists every YYYY-MM-DD day in [from..to] inclusive', () => {
    expect(enumerateDays('2026-11-01', '2026-11-03')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });

  it('returns a single day when from === to', () => {
    expect(enumerateDays('2026-11-15', '2026-11-15')).toEqual(['2026-11-15']);
  });

  it('returns [] on an inverted range', () => {
    expect(enumerateDays('2026-11-03', '2026-11-01')).toEqual([]);
  });

  it('returns [] on a corrupt date string', () => {
    expect(enumerateDays('not-a-date', '2026-11-03')).toEqual([]);
  });
});

describe('pivotSeries', () => {
  it('zero-fills days that have no series rows', () => {
    const stats = makeStats({
      from: '2026-11-01',
      to: '2026-11-03',
      series: [
        { date: '2026-11-02', type: 'business_view', count: 5 },
      ],
    });
    const buckets = pivotSeries(stats);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toEqual({ date: '2026-11-01', counts: {} });
    expect(buckets[1]).toEqual({ date: '2026-11-02', counts: { business_view: 5 } });
    expect(buckets[2]).toEqual({ date: '2026-11-03', counts: {} });
  });

  it('coalesces multiple types on the same day into one bucket', () => {
    const stats = makeStats({
      from: '2026-11-01',
      to: '2026-11-01',
      series: [
        { date: '2026-11-01', type: 'business_view', count: 3 },
        { date: '2026-11-01', type: 'call_click', count: 1 },
        { date: '2026-11-01', type: 'business_view', count: 2 },
      ],
    });
    const buckets = pivotSeries(stats);
    expect(buckets).toHaveLength(1);
    // business_view rows sum (the API may split a type across rows on edge cases).
    expect(buckets[0]!.counts).toEqual({ business_view: 5, call_click: 1 });
  });

  it('returns [] on a bad range', () => {
    const stats = makeStats({ from: 'bad', to: '2026-11-03' });
    expect(pivotSeries(stats)).toEqual([]);
  });
});

describe('buildFunnel', () => {
  it('computes conversion from the previous stage (first = 1.0)', () => {
    const stats = makeStats({
      totals: {
        business_view: 100,
        call_click: 20,
        direction_click: 5,
        share_click: 1,
        impression: 50, // not a funnel stage
      },
    });
    const stages = buildFunnel(stats, FUNNEL_LABELS);
    expect(stages).toHaveLength(4);
    expect(stages[0]!.total).toBe(100);
    expect(stages[0]!.conversionFromPrev).toBe(1);
    expect(stages[1]!.conversionFromPrev).toBeCloseTo(0.2, 5); // 20/100
    expect(stages[2]!.conversionFromPrev).toBeCloseTo(0.25, 5); // 5/20
    expect(stages[3]!.conversionFromPrev).toBeCloseTo(0.2, 5); // 1/5
  });

  it('returns conversion 0 when the previous stage is 0 (no divide-by-zero)', () => {
    const stats = makeStats({
      totals: {
        business_view: 0,
        call_click: 3,
        direction_click: 0,
        share_click: 0,
        impression: 0,
      },
    });
    const stages = buildFunnel(stats, FUNNEL_LABELS);
    expect(stages[0]!.conversionFromPrev).toBe(1);
    expect(stages[1]!.conversionFromPrev).toBe(0); // 3/0 → 0 (guard)
  });

  it('carries the localized label', () => {
    const stats = makeStats({ totals: { business_view: 1, call_click: 0, direction_click: 0, share_click: 0, impression: 0 } });
    const stages = buildFunnel(stats, FUNNEL_LABELS);
    expect(stages[0]!.labelKey).toBe('Views');
  });
});

describe('buildChartSeries + commonMax', () => {
  it('produces one series per event type (5 types), zero-filled, each with its max', () => {
    const buckets: DayBucket[] = [
      { date: '2026-11-01', counts: { business_view: 3, impression: 1 } },
      { date: '2026-11-02', counts: { business_view: 7 } },
    ];
    const series = buildChartSeries(buckets, {
      business_view: 'Views',
      call_click: 'Calls',
      direction_click: 'Directions',
      share_click: 'Shares',
      impression: 'Impressions',
    });
    expect(series).toHaveLength(5);
    const views = series.find((s) => s.type === 'business_view')!;
    expect(views.points).toHaveLength(2);
    expect(views.max).toBe(7);
    const calls = series.find((s) => s.type === 'call_click')!;
    expect(calls.max).toBe(0); // zero-filled, max 0
    expect(calls.points[0]!.value).toBe(0);
  });

  it('commonMax returns the largest single-type max', () => {
    const buckets: DayBucket[] = [
      { date: '2026-11-01', counts: { business_view: 10, impression: 25 } },
    ];
    const series = buildChartSeries(buckets, {
      business_view: 'Views',
      call_click: 'Calls',
      direction_click: 'Directions',
      share_click: 'Shares',
      impression: 'Impressions',
    });
    expect(commonMax(series)).toBe(25);
  });

  it('commonMax is 0 when all series are empty', () => {
    const series = buildChartSeries([], {
      business_view: 'Views',
      call_click: 'Calls',
      direction_click: 'Directions',
      share_click: 'Shares',
      impression: 'Impressions',
    });
    expect(commonMax(series)).toBe(0);
  });
});

describe('rangeWindow', () => {
  it('returns the last N days inclusive of today, as YYYY-MM-DD', () => {
    const w = rangeWindow(7);
    // Today is dynamic — assert the shape + the delta.
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(w.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const fromMs = Date.parse(`${w.from}T00:00:00Z`);
    const toMs = Date.parse(`${w.to}T00:00:00Z`);
    expect(Math.round((toMs - fromMs) / 86_400_000)).toBe(6); // 7 days incl today = 6-day span
  });

  it('today alone for N=1', () => {
    const w = rangeWindow(1);
    expect(w.from).toBe(w.to);
  });
});
