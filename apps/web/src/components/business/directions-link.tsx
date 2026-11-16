'use client';

/**
 * DirectionsLink (F7.7) — the «دستورالعمل مسیر» CTA on the public business
 * page, wrapped so a click fires one `direction_click` event.
 *
 * Privacy-first: `trackDirectionClick` is a no-op until consent is `granted`.
 * The link itself is unchanged (target=_blank, rel=noopener, the directions
 * URL from `@/lib/business-links`); only the click handler is added.
 *
 * Client component: the page is server-rendered; this is a tiny island that
 * takes the same props the inline `<a>` had plus `businessId` for the beacon.
 */
import { Navigation } from 'lucide-react';
import { trackDirectionClick } from '@/lib/analytics';

export interface DirectionsLinkProps {
  href: string;
  label: string;
  businessId: string;
}

export function DirectionsLink({ href, label, businessId }: DirectionsLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackDirectionClick(businessId)}
      className="inline-flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
      data-testid="business-directions"
    >
      <Navigation aria-hidden className="h-4 w-4" />
      {label}
    </a>
  );
}
