import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ForgotForm } from '../../../../components/auth/forgot-form';

/** `/forgot-password` (F1.8) — identifier → generic confirmation screen. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.forgot');
  return { title: t('title') };
}

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
