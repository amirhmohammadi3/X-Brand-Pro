import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { businessDetailSchema } from '@app/contracts';
import { apiFetchServer } from '../../../../../../lib/api/server';
import { isApiRequestError } from '../../../../../../lib/api/errors';
// Direct import (not the ui barrel) — the barrel re-exports `useZodForm`,
// a client-only hook that a Server Component cannot import. `Tabs` itself
// is a client component, which is fine here (it's rendered, not executed).
import { Tabs } from '../../../../../../components/ui/tabs';
import { BookingsCalendar } from '../../../../../../components/dashboard/bookings-calendar';
import { ServicesEditor } from '../../../../../../components/dashboard/services-editor';
import { ClosedDaysEditor } from '../../../../../../components/dashboard/closed-days-editor';

/** `/dashboard/:businessId/bookings` (F7.5) — booking settings + reservation
 *  calendar management.
 *
 * Server component: the business detail read gates ownership (a 404/403 →
 * `notFound()`); the three editors are client components that own their own
 * data fetching + cache invalidation. Tabs partition the console into the
 * calendar (the day-to-day operations view) and the two settings editors
 * (services, closed days). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('bookings.calendar.title') };
}

export default async function BookingsDashboardPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  try {
    // Probe ownership (the calendar list itself is owner-gated, but the
    // detail read is the canonical gate). 404/403 → notFound().
    await apiFetchServer(`/businesses/${businessId}`, businessDetailSchema);
  } catch (err) {
    if (isApiRequestError(err) && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const t = await getTranslations('dashboard');
  return (
    <Tabs
      defaultValue="calendar"
      tabs={[
        {
          value: 'calendar',
          label: t('bookings.tabs.calendar'),
          content: <BookingsCalendar businessId={businessId} />,
        },
        {
          value: 'services',
          label: t('bookings.tabs.services'),
          content: <ServicesEditor businessId={businessId} />,
        },
        {
          value: 'closed-days',
          label: t('bookings.tabs.closedDays'),
          content: <ClosedDaysEditor businessId={businessId} />,
        },
      ]}
    />
  );
}
