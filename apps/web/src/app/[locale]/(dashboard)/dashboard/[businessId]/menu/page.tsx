import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema, menuResponseSchema, type MenuResponse } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { MenuEditor } from '../../../../../../components/dashboard/menu-editor';

/** `/dashboard/:businessId/menu` (F7.3) — manage the menu (sections + items).
 *
 * Server component: fetches the business detail (ownership gate) and the
 * current menu; a 404/403 → `notFound()`. The menu editor is a client
 * component that takes the server-fetched menu as `initialMenu` and PUTs the
 * full snapshot on save. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('menu.title') };
}

export default async function MenuDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  let menu: MenuResponse;
  try {
    // The detail read gates ownership (the menu GET is public for active
    // businesses, so it can't gate on its own); 404/403 → notFound().
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
    const menuRes = await apiFetchServer(`/businesses/${businessId}/menu`, menuResponseSchema);
    menu = menuRes.data;
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  return <MenuEditor businessId={businessId} initialMenu={menu} />;
}
