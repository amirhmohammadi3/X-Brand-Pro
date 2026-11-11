import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BusinessRegistrationWizard } from '@/components/business/business-registration-wizard';

/**
 * Business registration route (F4.10) — `/[locale]/business/new`. A static
 * segment that takes precedence over the dynamic `/[locale]/business/[slug]`
 * route. The wizard itself is auth-gated (anonymous → login prompt); the page
 * is a thin server shell so first paint carries the heading + the gate copy.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('register');
  return { title: t('title') };
}

export default async function RegisterBusinessPage() {
  const tA11y = await getTranslations('a11y');
  return (
    <main
      id="main"
      aria-label={tA11y('mainContent')}
      className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6"
    >
      <BusinessRegistrationWizard />
    </main>
  );
}
