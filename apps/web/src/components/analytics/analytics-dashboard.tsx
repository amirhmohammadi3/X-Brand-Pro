'use client';

/**
 * AnalyticsDashboard (F7.8) — the `/dashboard/:businessId/analytics` body.
 *
 * The owner's analytics view: a range selector (7d / 30d / 90d), a row of
 * `Stat` cards for the five event-type totals (mirror of the F7.1 overview's
 * stat row, but driven by the chosen window), a per-type bar chart (one SVG
 * per event type, sharing a common y-axis max for cross-type comparison), and
 * the view → call → direction → share funnel.
 *
 * Data source: the B7.2 owner read `GET /analytics/business/:id/stats`, via
 * the existing `useBusinessStats(businessId, window)` hook (the F7.1 overview
 * already uses it; the cache key is shared so a window change refetches once).
 *
 * Self-hosted charts: the bar charts are hand-rolled SVG (no chart library —
 * the repo ethos is lean deps; the maps stack is already MapLibre-only). The
 * series is pivoted client-side from the API's flat `series` array.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, Phone, MapPin, Share2, Layers, type LucideIcon } from 'lucide-react';
import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { useBusinessStats } from '../../lib/api/businesses';
import {
  buildChartSeries,
  buildFunnel,
  commonMax,
  pivotSeries,
  RANGE_PRESETS,
  type FunnelStage,
} from '../../lib/analytics/pivot';
import { AnalyticsBarChart } from './analytics-bar-chart';
import { AnalyticsFunnel } from './analytics-funnel';
import { EmptyState, ErrorState, Heading, Spinner, Stat, Tabs } from '../ui';

/** One chart card per event type — order is the funnel (view → click) + impression. */
const EVENT_CARDS: ReadonlyArray<{
  type: AnalyticsEventType;
  icon: LucideIcon;
  labelKey: string;
}> = [
  { type: 'business_view', icon: Eye, labelKey: 'business.stats.views' },
  { type: 'call_click', icon: Phone, labelKey: 'business.stats.calls' },
  { type: 'direction_click', icon: MapPin, labelKey: 'business.stats.directions' },
  { type: 'share_click', icon: Share2, labelKey: 'business.stats.shares' },
  { type: 'impression', icon: Layers, labelKey: 'business.stats.impressions' },
];

export function AnalyticsDashboard({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);

  // Default to the 30d preset (matches the API default window).
  const [rangeKey, setRangeKey] = useState<'7d' | '30d' | '90d'>('30d');
  const preset = RANGE_PRESETS.find((p) => p.key === rangeKey)!;
  const window = useMemo(() => preset.window(), [preset]);

  const { stats, isPending, error } = useBusinessStats(businessId, window);

  if (error) {
    return <ErrorState error={t('analytics.loadError')} />;
  }
  if (isPending && !stats) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label={tRoot('common.loading')} />
      </div>
    );
  }
  if (!stats) {
    // Should not happen (isPending covers it), but keep the type-narrow.
    return <ErrorState error={t('analytics.loadError')} />;
  }

  // Pivot the flat series into per-day buckets + per-type chart series.
  const buckets = pivotSeries(stats);
  const labelsByType: Record<string, string> = Object.fromEntries(
    EVENT_CARDS.map((c) => [c.type, t(c.labelKey)]),
  );
  const series = buildChartSeries(buckets, labelsByType);
  const yMax = commonMax(series);
  const funnelLabels: Record<'business_view' | 'call_click' | 'direction_click' | 'share_click', string> = {
    business_view: t('business.stats.views'),
    call_click: t('business.stats.calls'),
    direction_click: t('business.stats.directions'),
    share_click: t('business.stats.shares'),
  };
  const stages: FunnelStage[] = buildFunnel(stats, funnelLabels);

  const totalEvents = ANALYTICS_EVENT_TYPES.reduce((sum, type) => sum + (stats.totals[type] ?? 0), 0);

  // Empty state: no events at all in the window — render the empty panel.
  const isEmpty = totalEvents === 0;

  return (
    <div className="flex flex-col gap-6" data-testid="dashboard-analytics">
      {/* Header + range selector */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Heading level="h2" className="text-lg">
          {t('analytics.title')}
        </Heading>
        <Tabs
          value={rangeKey}
          onValueChange={(v) => setRangeKey(v as '7d' | '30d' | '90d')}
          tabs={RANGE_PRESETS.map((p) => ({ value: p.key, label: t(p.labelKey), content: null }))}
        />
      </div>
      <p className="text-xs text-muted" data-testid="analytics-window">
        {t('analytics.window', { from: stats.from, to: stats.to })}
      </p>

      {isEmpty ? (
        <EmptyState
          icon={Layers}
          title={t('analytics.empty.title')}
          description={t('analytics.empty.body')}
        />
      ) : (
        <>
          {/* Totals row — one Stat per event type, mirroring the F7.1 overview. */}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {EVENT_CARDS.map(({ type, icon: Icon, labelKey }) => (
              <li key={type}>
                <Stat
                  label={t(labelKey)}
                  value={formatNumber(stats.totals[type] ?? 0)}
                  icon={<Icon className="size-4" aria-hidden />}
                />
              </li>
            ))}
          </ul>

          {/* Per-type daily bar charts — one SVG per event type, common max. */}
          <section aria-label={t('analytics.charts.title')} className="flex flex-col gap-4">
            <Heading level="h3" className="text-base">
              {t('analytics.charts.title')}
            </Heading>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {EVENT_CARDS.map(({ type, icon: Icon, labelKey }) => {
                const s = series.find((x) => x.type === type)!;
                return (
                  <li
                    key={type}
                    className="rounded-lg border border-border-subtle bg-surface p-3"
                    data-testid="analytics-chart-card"
                  >
                    <div className="mb-2 flex items-center gap-2 text-sm text-text-subtle">
                      <Icon className="size-4" aria-hidden />
                      <span>{t(labelKey)}</span>
                      <span className="ms-auto tabular-nums text-text">
                        {formatNumber(stats.totals[type] ?? 0)}
                      </span>
                    </div>
                    <AnalyticsBarChart label={t(labelKey)} points={s.points} max={yMax} />
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Funnel — view → call → direction → share (impression excluded). */}
          <section aria-label={t('analytics.funnel.title')} className="flex flex-col gap-2">
            <Heading level="h3" className="text-base">
              {t('analytics.funnel.title')}
            </Heading>
            <div className="rounded-lg border border-border-subtle bg-surface p-4">
              <AnalyticsFunnel stages={stages} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
