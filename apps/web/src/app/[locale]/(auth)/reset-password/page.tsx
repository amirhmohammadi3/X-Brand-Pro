import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ResetForm } from '../../../../components/auth/reset-form';

/** `/reset-password` (F1.8) — code + new password; identifier prefilled. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.reset');
  return { title: t('title') };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ identifier?: string }>;
}) {
  const { identifier } = await searchParams;
  return <ResetForm initialIdentifier={identifier ?? ''} />;
}
