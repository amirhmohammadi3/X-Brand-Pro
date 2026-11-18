import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { BillingDashboard } from '../../../../../../components/billing/billing-dashboard';

/** `/dashboard/:businessId/billing` (F8.1) — the owner's billing view.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the plan catalog + subscription + invoices are re-fetched
 * client-side by the dashboard (TanStack Query) so a checkout/cancel
 * refreshes immediately. The B8.2 owner reads (`GET /billing/businesses/:id/
 * subscription` + `GET /billing/businesses/:id/invoices`) + the public
 * `GET /billing/plans` are the only data sources; no new backend endpoint. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('billing.title') };
}

export default async function BillingDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    // Probe ownership — the billing reads re-check it, but this gates a 404 here.
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <BillingDashboard businessId={businessId} />;
}
