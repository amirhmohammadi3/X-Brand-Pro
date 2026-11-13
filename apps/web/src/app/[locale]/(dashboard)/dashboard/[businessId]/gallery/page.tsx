import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessPhotosResultSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { GalleryEditor } from '../../../../../../components/dashboard/gallery-editor';

/** `/dashboard/:businessId/gallery` (F7.3) — manage the photo gallery.
 *
 * Server component: a 404/403 on the photos read means "not yours / doesn't
 * exist" → `notFound()`. The gallery editor itself is a client component
 * (upload, reorder, cover, delete); it re-fetches the list client-side via
 * `useBusinessPhotos` so an attach/delete reflects immediately. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('gallery.title') };
}

export default async function GalleryDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  // Probe ownership with a cheap read; the editor owns the live list.
  try {
    await apiFetchServer(`/businesses/${businessId}/photos`, businessPhotosResultSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <GalleryEditor businessId={businessId} />;
}
