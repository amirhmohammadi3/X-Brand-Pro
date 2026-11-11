import { getTranslations } from 'next-intl/server';
import { Phone, MessageCircle, Send, Camera, Globe, Mail, type LucideIcon } from 'lucide-react';
import { whatsappUrl, telegramUrl, instagramUrl, websiteUrl } from '@/lib/business-links';
import type { BusinessDetail } from '@app/contracts';

/**
 * Business contact section (F4.1). The call/WhatsApp/Telegram/Instagram/
 * website/email channels the B2.6 detail carries, each as an icon link.
 *
 * Outbound third-party URLs (wa.me, t.me, instagram.com) are built by
 * `@/lib/business-links` where the host literals are tagged `// external-ok`
 * (user-clicked navigation, not a runtime asset request — AGENTS.md §7). The
 * `tel:` and `mailto:` schemes and the runtime `website` value carry no
 * third-party host literal in source and need no tag.
 *
 * Server component: `getTranslations('businessPage')` is awaited here.
 */

function ContactLink({
  href,
  label,
  Icon,
  external,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary hover:text-primary"
      data-testid="business-contact-link"
    >
      <Icon aria-hidden className="h-4 w-4" />
      {label}
    </a>
  );
}

export interface BusinessContactsProps {
  business: BusinessDetail;
  locale: string;
}

export async function BusinessContacts({ business }: BusinessContactsProps) {
  const t = await getTranslations('businessPage');
  const wa = whatsappUrl(business.whatsapp);
  const tg = telegramUrl(business.telegram);
  const ig = instagramUrl(business.instagram);
  const web = websiteUrl(business.website);
  const links: Array<{ href: string; label: string; Icon: LucideIcon; external?: boolean }> = [];
  if (business.phone)
    links.push({ href: `tel:${business.phone}`, label: t('contact.call'), Icon: Phone });
  if (wa)
    links.push({ href: wa, label: t('contact.whatsapp'), Icon: MessageCircle, external: true });
  if (tg) links.push({ href: tg, label: t('contact.telegram'), Icon: Send, external: true });
  if (ig) links.push({ href: ig, label: t('contact.instagram'), Icon: Camera, external: true });
  if (web) links.push({ href: web, label: t('contact.website'), Icon: Globe, external: true });
  if (business.email)
    links.push({ href: `mailto:${business.email}`, label: t('contact.email'), Icon: Mail });

  if (links.length === 0) {
    return <p className="text-sm text-muted">{t('contact.noContacts')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="business-contacts">
      {links.map((l) => (
        <ContactLink key={l.href} {...l} />
      ))}
    </div>
  );
}
