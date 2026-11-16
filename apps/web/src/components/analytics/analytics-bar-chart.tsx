'use client';

/**
 * AnalyticsBarChart (F7.8) — a self-hosted, dependency-free SVG bar chart for
 * a single event-type's daily counts.
 *
 * Why hand-rolled SVG: the repo carries no chart library and the data is
 * simple (one series × ≤90 day-points). A small SVG keeps the bundle lean,
 * stays in the codebase's "no heavy deps" ethos (the maps stack is already
 * MapLibre-only), and renders crisply at any zoom. No external script, no CDN.
 *
 * The chart is accessible: a `<table>` mirror of the data is rendered visually
 * hidden (sr-only) so a screen reader reads the actual numbers, while the SVG
 * carries `role="img"` + an `aria-label` summary. The bars are not interactive
 * (a tooltip would add complexity for little value on a 30-day owner view);
 * the exact daily counts live in the sr-only table for anyone who needs them.
 *
 * RTL-aware: the bars flow inline-start→inline-end by date (a timeline reads
 * the same way in every locale); the y-axis labels use the logical `text-anchor`
 * so they follow the inline-start side in both LTR and RTL.
 */
import { useId } from 'react';
import { useLocale } from 'next-intl';
import { createFormatters } from '../../lib/format';

export interface BarChartProps {
  /** The event-type label, shown in the aria-label + the legend. */
  label: string;
  /** Daily counts, ascending by date. One bar per entry. */
  points: Array<{ date: string; value: number }>;
  /** The shared y-axis max (so multiple charts scale together). 0 → empty. */
  max: number;
}

const WIDTH = 600;
const HEIGHT = 160;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 20; // x-axis date labels
const BAR_GAP = 1;

export function AnalyticsBarChart({ label, points, max }: BarChartProps) {
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const gradientId = useId();
  const safeMax = Math.max(max, 1); // avoid divide-by-zero on an empty window
  const chartW = WIDTH - PAD_X * 2;
  const chartH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barW = points.length > 0 ? Math.max(chartW / points.length - BAR_GAP, 1) : 0;

  return (
    <div data-testid="analytics-bar-chart" className="w-full">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        style={{ height: 'auto' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        {/* y-axis baseline */}
        <line
          x1={PAD_X}
          y1={PAD_TOP + chartH}
          x2={WIDTH - PAD_X}
          y2={PAD_TOP + chartH}
          stroke="var(--color-border-subtle)"
          strokeWidth="1"
        />
        {points.length === 0 ? (
          <text
            x={WIDTH / 2}
            y={HEIGHT / 2}
            textAnchor="middle"
            className="fill-text-subtle"
            style={{ fontSize: 12 }}
          >
            —
          </text>
        ) : (
          points.map((p, i) => {
            const h = (p.value / safeMax) * chartH;
            const x = PAD_X + i * (barW + BAR_GAP);
            const y = PAD_TOP + chartH - h;
            return (
              <rect
                key={p.date}
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                rx={1}
                fill={`url(#${gradientId})`}
              >
                <title>
                  {p.date}: {formatNumber(p.value)}
                </title>
              </rect>
            );
          })
        )}
      </svg>
      {/* Accessible data mirror — a screen reader reads the real numbers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{locale === 'fa' ? 'تاریخ' : 'Date'}</th>
            <th scope="col">{locale === 'fa' ? 'تعداد' : 'Count'}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.date}</th>
              <td>{formatNumber(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
