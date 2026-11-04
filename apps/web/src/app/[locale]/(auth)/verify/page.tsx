import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '../../../../lib/auth/guard';
import { Forbidden } from '../../../../components/layout/forbidden';
import { VerifyClient } from '../../../../components/auth/verify-client';

/**
 * `/verify` (F1.8) — email/phone verification, reached from the account
 * area. It lives in the `(auth)` group but requires a session: anonymous
 * visitors are redirected to `/login?next=/verify` by the guard.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.verify');
  return { title: t('title') };
}

export default async function VerifyPage() {
  const { decision } = await requireUser({ pathname: '/verify' });
  if (decision.kind === 'forbidden') {
    return <Forbidden />;
  }
  if (decision.kind !== 'allow') {
    // requireUser already redirected for the `login` decision.
    return null;
  }
  return <VerifyClient user={decision.user} />;
}
