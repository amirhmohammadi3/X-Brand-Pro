import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '../../../lib/auth/guard';
import { MyBookingsView } from '../../../components/bookings/my-bookings';

/** Extract the request pathname (referer fallback, mirrors account/layout). */
async function readPathname(): Promise<string> {
  const h = await headers();
  const explicit = h.get('x-pathname');
  if (explicit) return explicit;
  const referer = h.get('referer');
  if (referer) {
    try {
      return new URL(referer).pathname;
    } catch {
      // fall through
    }
  }
  return '/bookings';
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bookings');
  return { title: t('mine.title') };
}

/**
 * «رزروهای من» (F6.2). Login required (every role — a business owner books
 * too); anonymous → `/login?next=/bookings`. The list itself is the
 * MyBookingsView client component (scope tabs, status chips, cancel,
 * calendar feed).
 */
export default async function BookingsPage() {
  const pathname = await readPathname();
  await requireUser({ pathname });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <MyBookingsView />
    </main>
  );
}
