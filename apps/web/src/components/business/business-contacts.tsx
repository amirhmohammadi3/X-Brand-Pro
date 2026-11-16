'use client';

import { useTranslations } from 'next-intl';
import { Phone, MessageCircle, Send, Camera, Globe, Mail, type LucideIcon } from 'lucide-react';
import { whatsappUrl, telegramUrl, instagramUrl, websiteUrl } from '@/lib/business-links';
import { trackCallClick } from '@/lib/analytics';
import type { BusinessDetail } from '@app/contracts';

/**
 * Business contact section (F4.1, F7.7 tracking). The call/WhatsApp/Telegram/
 * Instagram/website/email channels the B2.6 detail carries, each as an icon
 * link.
 *
 * F7.7: a click on the `tel:` link fires one `call_click` event (privacy-first:
 * the tracker is a no-op until consent is granted). The other channels
 * (WhatsApp/Telegram/etc.) are NOT tracked — only the API's measurable call
 * CTA is, matching the B7.1 event vocabulary.
 *
 * Outbound third-party URLs (wa.me, t.me, instagram.com) are built by
 * `@/lib/business-links` where the host literals are tagged `// external-ok`
 * (user-clicked navigation, not a runtime asset request — AGENTS.md §7). The
 * `tel:` and `mailto:` schemes and the runtime `website` value carry no
 * third-party host literal in source and need no tag.
 *
 * Client component: F7.7 wires a click handler on the call link; the section
 * was a server component in F4.1 and is now a client island so the handler
 * can attach. `useTranslations('businessPage')` is the client-side mirror of
 * the F4.1 `getTranslations` call.
 */

function ContactLink({
  href,
  label,
  Icon,
  external,
  onClick,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  external?: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
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
  /** Kept for the F4.1 signature; the client `useTranslations` ignores it. */
  locale: string;
}

export function BusinessContacts({ business }: BusinessContactsProps) {
  const t = useTranslations('businessPage');
  const wa = whatsappUrl(business.whatsapp);
  const tg = telegramUrl(business.telegram);
  const ig = instagramUrl(business.instagram);
  const web = websiteUrl(business.website);
  const links: Array<{
    href: string;
    label: string;
    Icon: LucideIcon;
    external?: boolean;
    onClick?: () => void;
  }> = [];
  if (business.phone)
    links.push({
      href: `tel:${business.phone}`,
      label: t('contact.call'),
      Icon: Phone,
      // F7.7: fire one call_click on the tap-to-call CTA.
      onClick: () => trackCallClick(business.id),
    });
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
