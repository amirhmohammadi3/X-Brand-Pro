'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { shareWhatsAppUrl, shareTelegramUrl, shareInstagramUrl } from '@/lib/business-links';

/**
 * Page share (F4.9) — WhatsApp / Telegram / Instagram / copy-link / native
 * Web Share. The shared URL is the current business page (`window.location.
 * href`); the title carries the business name. The WhatsApp/Telegram/
 * Instagram links are user-clicked navigation (tagged `// external-ok` in
 * business-links.ts); copy uses the Clipboard API; native uses `navigator.
 * share` when the browser exposes it (mobile). Instagram has no web share
 * scheme, so its button opens the app/site after the link is copied.
 *
 * Client component: the open/copy state is interactive. A disclosure toggle
 * keeps the share surface off the critical path until the user asks for it.
 */
export interface BusinessShareProps {
  /** The business name — used as the share text/title. */
  title: string;
}

export function BusinessShare({ title }: BusinessShareProps) {
  const t = useTranslations('share');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = typeof window !== 'undefined' ? window.location.href : '';
  const wa = shareWhatsAppUrl(url, title);
  const tg = shareTelegramUrl(url);
  const ig = shareInstagramUrl();

  async function copyLink() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — leave the button as-is
    }
  }

  async function nativeShare() {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title, url });
    } catch {
      // user dismissed the share sheet — no-op
    }
  }

  const hasNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const linkClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-primary hover:text-primary';

  return (
    <div className="relative" data-testid="business-share">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={linkClass}
        data-testid="business-share-toggle"
      >
        {t('button')}
      </button>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="business-share-options">
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="business-share-whatsapp"
          >
            {t('whatsapp')}
          </a>
          <a
            href={tg}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="business-share-telegram"
          >
            {t('telegram')}
          </a>
          <a
            href={ig}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
            data-testid="business-share-instagram"
          >
            {t('instagram')}
          </a>
          <button
            type="button"
            onClick={copyLink}
            className={linkClass}
            data-testid="business-share-copy"
          >
            {copied ? t('copied') : t('copy')}
          </button>
          {hasNative ? (
            <button
              type="button"
              onClick={nativeShare}
              className={linkClass}
              data-testid="business-share-native"
            >
              {t('native')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
