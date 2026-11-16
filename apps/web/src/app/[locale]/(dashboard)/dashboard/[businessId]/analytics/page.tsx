import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { AnalyticsDashboard } from '../../../../../../components/analytics/analytics-dashboard';

/** `/dashboard/:businessId/analytics` (F7.8) — the owner's analytics view.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the analytics stats are re-fetched client-side by the
 * dashboard so a range change refetches immediately. Self-hosted charts (no
 * chart library — the bar charts are hand-rolled SVG, the funnel is a styled
 * list). The B7.2 owner read `GET /analytics/business/:id/stats` is the only
 * data source; no new backend endpoint, no new contract, no new migration. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('analytics.title') };
}

export default async function AnalyticsDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    // Probe ownership — the stats read re-checks it, but this gates a 404 here.
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <AnalyticsDashboard businessId={businessId} />;
}
