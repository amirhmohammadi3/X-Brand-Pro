import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BRAND } from '../../../lib/brand';
import { Container } from '../../../components/layout/container';
import { ArrowLeft } from 'lucide-react';

/**
 * `(auth)` route group (F1.7). Centered card layout for login/register/
 * forgot/verify. A minimal header (brand mark only) and a back link; no
 * footer or mobile tab bar (keeps the auth focus tight).
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tBrand = await getTranslations('brand');
  const tLayout = await getTranslations('layout');

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="py-4">
        <Container className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" aria-label={tBrand('name')}>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-on-primary">
              {BRAND.mark}
            </span>
            <span className="text-base font-semibold text-text">{tBrand('name')}</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-text-subtle hover:text-text"
          >
            <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" />
            {tLayout('backToHome')}
          </Link>
        </Container>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
