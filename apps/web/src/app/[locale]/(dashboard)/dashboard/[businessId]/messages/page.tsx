import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { MessagesEditor } from '../../../../../../components/dashboard/messages-editor';

/** `/dashboard/:businessId/messages` (F7.6) — the owner's DM inbox shortcut.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the inbox itself is the owner-as-user DM list (B5.6,
 * user-scoped, NOT business-scoped) re-fetched client-side by the editor so a
 * new message reflects immediately. The conversation thread links out to the
 * existing `/account/messages/:id` route (F5.6), which owns the realtime
 * subscription + composer + mark-read + delete + report flows. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('messages.title') };
}

export default async function MessagesDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    // Probe ownership (the inbox read can't gate on it — DMs are user-scoped).
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <MessagesEditor businessId={businessId} />;
}
