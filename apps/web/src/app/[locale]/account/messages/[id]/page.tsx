import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConversationThread } from '../../../../../components/account/conversation-thread';

/** `/account/messages/[id]` (F5.6) — one DM thread with realtime + composer. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account.messages');
  return { title: t('title') };
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConversationThread conversationId={id} />;
}
