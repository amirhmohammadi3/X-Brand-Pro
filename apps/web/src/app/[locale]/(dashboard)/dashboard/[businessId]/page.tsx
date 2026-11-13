import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  analyticsStatsResultSchema,
  businessDetailSchema,
  type AnalyticsStatsResult,
  type BusinessDetail,
} from '@app/contracts';
import { apiFetchServer } from '../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../lib/api/errors';
import { BusinessOverview } from '../../../../../components/dashboard/business-overview';

/** `/dashboard/:businessId` (F7.1) — the per-business dashboard landing.
 *
 * Server component: fetches the business detail (`GET /businesses/:id`, which
 * the API gates on ownership for non-active rows) and the B7.2 stats
 * (`GET /analytics/business/:id/stats`, owner-only). A 404/403 from either
 * means "not yours / doesn't exist" → `notFound()`. The body is the
 * `BusinessOverview` client component (header, stat cards, section
 * shortcuts). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('business.title') };
}

export default async function BusinessDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;

  let business: BusinessDetail;
  let stats: AnalyticsStatsResult | null = null;
  try {
    const detailRes = await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
    business = detailRes.data;
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  // Stats are best-effort: a brand-new business has no events yet, and the
  // analytics endpoint never blocks the dashboard from rendering.
  try {
    const statsRes = await apiFetchServer(
      `/analytics/business/${businessId}/stats`,
      analyticsStatsResultSchema,
    );
    stats = statsRes.data;
  } catch {
    stats = null;
  }

  return <BusinessOverview business={business} stats={stats} />;
}
