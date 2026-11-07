import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsForm } from '../../../../components/account/settings-form';

/** `/account/settings` (F1.9) — password, Google, sessions and delete account. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.settings');
  return { title: t('title') };
}

export default function SettingsPage() {
  return <SettingsForm />;
}
