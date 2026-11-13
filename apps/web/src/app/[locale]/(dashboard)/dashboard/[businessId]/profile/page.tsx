import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  businessDetailSchema,
  hoursResponseSchema,
  type BusinessDetail,
  type HoursResponse,
} from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
import { ProfileEditor } from '../../../../../../components/dashboard/profile-editor';
import { HoursEditor } from '../../../../../../components/dashboard/hours-editor';
import { LocationEditor } from '../../../../../../components/dashboard/location-editor';

/** `/dashboard/:businessId/profile` (F7.2) — edit profile, hours and location.
 *
 * Server component: fetches the business detail (ownership gated by the API)
 * and the weekly hours. A 404/403 → `notFound()`. The three editors
 * (ProfileEditor, HoursEditor, LocationEditor) are client components that
 * PATCH/PUT their own slices; hours are best-effort (a brand-new business has
 * an empty schedule, which the editor handles as "all closed"). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('profile.title') };
}

export default async function ProfileDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;

  let business: BusinessDetail;
  let hours: HoursResponse;
  try {
    const [detailRes, hoursRes] = await Promise.all([
      apiFetchServer(`/businesses/${businessId}`, businessDetailSchema),
      apiFetchServer(`/businesses/${businessId}/hours`, hoursResponseSchema),
    ]);
    business = detailRes.data;
    hours = hoursRes.data;
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">{business.name}</h1>
        <p className="mt-1 text-sm text-text-subtle">{business.address}</p>
      </header>
      <ProfileEditor business={business} />
      <HoursEditor businessId={business.id} hours={hours} />
      <LocationEditor business={business} />
    </div>
  );
}
