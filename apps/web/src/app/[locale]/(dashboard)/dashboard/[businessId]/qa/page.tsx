import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { QaEditor } from '../../../../../../components/dashboard/qa-editor';

/** `/dashboard/:businessId/qa` (F7.4) — the owner's Q&A console.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the questions list itself is public and re-fetched
 * client-side by the editor so an answer write reflects immediately. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('qa.title') };
}

export default async function QaDashboardPage({
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
  return <QaEditor businessId={businessId} />;
}
