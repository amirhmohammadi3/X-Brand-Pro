'use client';

/**
 * AdminRevenueDashboard (F8.4) — the `/admin/revenue` body.
 *
 * The admin-facing aggregate over verified payments: a range selector
 * (7d / 30d / 90d / custom), the total revenue + transactions + average
 * stat cards, and the byPurpose + byPlan breakdown tables. The window
 * defaults to the last 30 days.
 *
 * Data source: GET /billing/revenue (B8.6, admin-only via businesses.manage).
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingUp, Receipt, Hash } from 'lucide-react';
import { createFormatters } from '../../lib/format';
import { useRevenueReport } from '../../lib/api/admin-revenue';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Heading, Spinner, Text, Stat } from '../ui';

const RANGE_PRESETS = [
  { value: '7d', days: 7, labelKey: 'range.7d' },
  { value: '30d', days: 30, labelKey: 'range.30d' },
  { value: '90d', days: 90, labelKey: 'range.90d' },
] as const;

function rangeWindow(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function AdminRevenueDashboard() {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const formatPrice = (tomans: number) => `${formatNumber(tomans)} ${tRoot('common.currency.toman')}`;
  const [range, setRange] = useState<(typeof RANGE_PRESETS)[number]['value']>('30d');
  const window = rangeWindow(RANGE_PRESETS.find((r) => r.value === range)!.days);
  const { report, isPending, error } = useRevenueReport(window.from, window.to);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level="h1">{t('admin.revenue.title')}</Heading>
        <div className="flex gap-1">
          {RANGE_PRESETS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`rounded border px-3 py-1.5 text-sm ${
                range === r.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border-subtle text-text-subtle hover:text-text'
              }`}
              onClick={() => setRange(r.value)}
            >
              {t(`admin.revenue.${r.labelKey}`)}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={t('common.error')} />
      ) : !report ? (
        <EmptyState icon={Receipt} title={t('admin.revenue.empty')} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              icon={<TrendingUp className="h-4 w-4" />}
              label={t('admin.revenue.totalRevenue')}
              value={formatPrice(report.totalRevenue)}
            />
            <Stat
              icon={<Receipt className="h-4 w-4" />}
              label={t('admin.revenue.totalTransactions')}
              value={formatNumber(report.totalTransactions)}
            />
            <Stat
              icon={<Hash className="h-4 w-4" />}
              label={t('admin.revenue.averageTransaction')}
              value={formatPrice(report.averageTransaction)}
            />
          </div>

          <Card>
            <CardHeader>
              <Heading level="h3">{t('admin.revenue.byPurpose')}</Heading>
            </CardHeader>
            <CardBody>
              {report.byPurpose.length === 0 ? (
                <Text size="sm" muted>
                  {t('admin.revenue.empty')}
                </Text>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 text-start">{t('admin.revenue.purpose')}</th>
                        <th className="p-2 text-start">{t('admin.revenue.count')}</th>
                        <th className="p-2 text-start">{t('admin.revenue.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byPurpose.map((row) => (
                        <tr key={row.purpose} className="border-b">
                          <td className="p-2">{t(`admin.revenue.purpose.${row.purpose}`)}</td>
                          <td className="p-2">{formatNumber(row.count)}</td>
                          <td className="p-2">{formatPrice(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <Heading level="h3">{t('admin.revenue.byPlan')}</Heading>
            </CardHeader>
            <CardBody>
              {report.byPlan.length === 0 ? (
                <Text size="sm" muted>
                  {t('admin.revenue.empty')}
                </Text>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 text-start">{t('admin.revenue.planTier')}</th>
                        <th className="p-2 text-start">{t('admin.revenue.count')}</th>
                        <th className="p-2 text-start">{t('admin.revenue.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byPlan.map((row, i) => (
                        <tr key={row.planTier ?? `null-${i}`} className="border-b">
                          <td className="p-2">
                            {row.planTier ? t(`billing.plan.${row.planTier}.name`) : '—'}
                          </td>
                          <td className="p-2">{formatNumber(row.count)}</td>
                          <td className="p-2">{formatPrice(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
