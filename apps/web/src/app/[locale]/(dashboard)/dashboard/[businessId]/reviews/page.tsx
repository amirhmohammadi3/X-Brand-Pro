import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { ReviewsEditor } from '../../../../../../components/dashboard/reviews-editor';

/** `/dashboard/:businessId/reviews` (F7.4) — the owner's reviews console.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the reviews list itself is public and re-fetched client-side
 * by the editor so a reply write reflects immediately. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('reviews.title') };
}

export default async function ReviewsDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    // Probe ownership (the public list can't gate on its own). 404/403 → notFound().
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <ReviewsEditor businessId={businessId} />;
}
