import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { CampaignsDashboard } from '../../../../../../components/ads/campaigns-dashboard';

/** `/dashboard/:businessId/campaigns` (F8.2) — the owner's ad campaigns view.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the campaign list + stats are re-fetched client-side by the
 * dashboard (TanStack Query) so a create/status/checkout refreshes
 * immediately. The B8.3 owner reads (`GET /ads/businesses/:id/campaigns` +
 * `GET /ads/campaigns/:id/stats`) are the only data sources; no new backend
 * endpoint. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('campaigns.title') };
}

export default async function CampaignsDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <CampaignsDashboard businessId={businessId} />;
}
