import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MessagingInbox } from '../../../../components/account/messaging-inbox';

/** `/account/messages` (F5.6) — the DM inbox. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.messages');
  return { title: t('title') };
}

export default function MessagesPage() {
  return <MessagingInbox />;
}
