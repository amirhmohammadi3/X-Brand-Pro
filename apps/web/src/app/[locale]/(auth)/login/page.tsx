import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '../../../../components/auth/login-form';

/** `/login` (F1.8) — password and OTP tabs inside the `(auth)` card. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.login');
  return { title: t('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm initialNext={next ?? ''} />;
}
