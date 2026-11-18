'use client';

/**
 * PaymentCallbackPage (F8.1) — `/[locale]/payments/callback?id=…`.
 *
 * The page the gateway redirects the user to after payment. The URL carries
 * `?id=<paymentId>` (the API builds this callback URL when it creates the
 * payment intent). The page calls `POST /payments/:id/verify` — idempotent,
 * so a re-visit after a successful verify returns the same result.
 *
 * On `{ verified: true }`:
 *   - invalidate the billing cache (the settled invoice + the activated sub
 *     appear in the dashboard);
 *   - route back to the caller's billing dashboard.
 *
 * On `{ verified: false }`:
 *   - show the failure + a retry button (re-runs the checkout from the
 *     billing page).
 *
 * The fake driver redirects here with `about:blank` short-circuited (the
 * checkout's `useCheckoutFlow` routes straight here); a real Zarinpal
 * sandbox payment redirects back with `?Authority=…&Status=OK` query params
 * that the API's verify reads (the row's stored authority is the source of
 * truth when the query is absent).
 */
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useVerifyPayment } from '../../lib/api/billing';
import { Button, Card, CardBody, Heading, Text } from '../ui';

type Phase = 'verifying' | 'verified' | 'failed' | 'missing';

export function PaymentCallbackClient() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const search = useSearchParams();
  const paymentId = search.get('id');
  const authority = search.get('Authority') ?? undefined;
  const verify = useVerifyPayment(paymentId ?? '');
  const [phase, setPhase] = useState<Phase>('verifying');

  useEffect(() => {
    if (!paymentId) {
      setPhase('missing');
      return;
    }
    let active = true;
    (async () => {
      try {
        const result = await verify.mutateAsync();
        if (!active) return;
        setPhase(result.verified ? 'verified' : 'failed');
      } catch {
        if (!active) return;
        setPhase('failed');
      }
    })();
    return () => {
      active = false;
    };
  }, [paymentId, authority]);

  return (
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardBody className="space-y-6 text-center">
          {phase === 'verifying' && (
            <>
              <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
              <Heading level="h2">{t('payment.verifying')}</Heading>
              <Text size="sm" muted>
                {t('payment.verifyingDescription')}
              </Text>
            </>
          )}
          {phase === 'verified' && (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
              <Heading level="h2">{t('payment.verified')}</Heading>
              <Text size="sm" muted>
                {t('payment.verifiedDescription')}
              </Text>
              <Button onClick={() => router.push(`/${document.documentElement.lang || 'fa'}/dashboard`)}>
                {t('payment.backToDashboard')}
              </Button>
            </>
          )}
          {phase === 'failed' && (
            <>
              <XCircle className="mx-auto h-12 w-12 text-danger" />
              <Heading level="h2">{t('payment.failed')}</Heading>
              <Text size="sm" muted>
                {t('payment.failedDescription')}
              </Text>
              <Button variant="ghost" onClick={() => router.push(`/${document.documentElement.lang || 'fa'}/dashboard`)}>
                {t('payment.backToDashboard')}
              </Button>
            </>
          )}
          {phase === 'missing' && (
            <>
              <XCircle className="mx-auto h-12 w-12 text-danger" />
              <Heading level="h2">{t('payment.missing')}</Heading>
              <Button variant="ghost" onClick={() => router.push(`/${document.documentElement.lang || 'fa'}/dashboard`)}>
                {t('payment.backToDashboard')}
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
