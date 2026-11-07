import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfileForm } from '../../../../components/account/profile-form';

/** `/account/profile` (F1.9) — identity, avatar, username and verification. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.profile');
  return { title: t('title') };
}

export default function ProfilePage() {
  return <ProfileForm />;
}
