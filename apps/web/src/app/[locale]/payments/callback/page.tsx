import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { PaymentCallbackClient } from '../../../../components/billing/payment-callback-client';

/** `/[locale]/payments/callback` (F8.1) — the post-gateway payment verify.
 *
 * Server component: thin wrapper around the client body (which reads the
 * `?id=` + `?Authority=` query params + calls POST /payments/:id/verify). No
 * API call here — the verify is client-side so the page renders the
 * verifying spinner immediately + invalidates the billing cache on success. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('payment.title') };
}

export default async function PaymentCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PaymentCallbackClient />
    </Suspense>
  );
}
