'use client';

/**
 * AnalyticsFunnel (F7.8) — the view → call → direction → share funnel.
 *
 * Renders one horizontal bar per stage, scaled to the FIRST stage's width
 * (so the bars visually narrow as conversion drops). Each bar carries the
 * stage's total + the conversion rate from the previous stage (the first
 * stage shows "—" since it has no predecessor). Colors are NOT used to encode
 * meaning — each stage's label + number is the data; the bar width is a
 * redundant visual cue only.
 *
 * Accessible: the stages are a `<ol>` (an ordered list — funnel order is
 * meaningful), each `<li>` carrying the stage label, total, and conversion.
 * The bars themselves are presentational (`aria-hidden`).
 */
import { useLocale, useTranslations } from 'next-intl';
import { createFormatters } from '../../lib/format';
import type { FunnelStage } from '../../lib/analytics/pivot';

export function AnalyticsFunnel({ stages }: { stages: FunnelStage[] }) {
  const t = useTranslations('dashboard.analytics');
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  if (stages.length === 0) return null;
  const first = stages[0]!;
  const firstTotal = Math.max(first.total, 1); // avoid 0-width bars on an empty funnel

  return (
    <ol data-testid="analytics-funnel" className="flex flex-col gap-2">
      {stages.map((stage, i) => {
        const widthPct = (stage.total / firstTotal) * 100;
        const convPct = stage.conversionFromPrev * 100;
        return (
          <li key={stage.type} className="flex flex-col gap-1" data-testid="analytics-funnel-stage">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-text">{stage.labelKey}</span>
              <span className="tabular-nums text-text-subtle">
                {formatNumber(stage.total)}
                {i > 0 ? (
                  <span className="ms-2 text-xs text-muted">
                    {t('funnel.conv', { pct: formatNumber(Math.round(convPct)) })}
                  </span>
                ) : null}
              </span>
            </div>
            {/* The bar — aria-hidden (the numbers are the data, the bar is a
                visual cue only). RTL-safe: it grows from the inline-start. */}
            <div
              aria-hidden
              className="h-2 rounded-full bg-primary/20"
              data-testid="analytics-funnel-bar"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(widthPct, 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
