'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui';
import type { BusinessPhoto } from '@app/contracts';

/**
 * Business image gallery (F4.2). A responsive thumbnail grid backed by the
 * B4.9 aggregate's `photos` (sorted by `sortOrder`); clicking a thumbnail
 * opens a lightbox `Modal` with the full image, a `{i} of {n}` counter, and
 * prev/next buttons that cycle modulo the gallery length.
 *
 * RTL: in `fa` the layout is reversed, so the visual "next" (بعدی) leads
 * and ArrowLeft advances forward; the chevron glyphs and arrow-key mapping
 * flip accordingly (`useLocale`). Raw `<img>`: media URLs are same-origin
 * /media proxies (B2.7 pattern — no Next Image round-trip for user content).
 *
 * Client component: the lightbox open index and keyboard nav are interactive
 * state. The section heading is rendered by the server page; this component
 * owns only the grid + lightbox.
 */
export interface BusinessGalleryProps {
  photos: BusinessPhoto[];
}

export function BusinessGallery({ photos }: BusinessGalleryProps) {
  const t = useTranslations('businessPage.gallery');
  const locale = useLocale();
  const isRtl = locale === 'fa';
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const sorted = [...photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const count = sorted.length;

  const goPrev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);
  const goNext = useCallback(() => setIndex((i) => (i + 1) % count), [count]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        if (isRtl) goNext();
        else goPrev();
      } else if (e.key === 'ArrowRight') {
        if (isRtl) goPrev();
        else goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isRtl, goPrev, goNext]);

  if (count === 0) return null;
  const current = sorted[index];
  if (!current) return null;

  const prevChevron = isRtl ? '›' : '‹';
  const nextChevron = isRtl ? '‹' : '›';

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="business-gallery-grid">
        {sorted.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setIndex(i);
              setOpen(true);
            }}
            className="aspect-square overflow-hidden rounded-lg border border-border-subtle bg-surface-alt transition-opacity hover:opacity-90"
            aria-label={t('count', { i: i + 1, n: count })}
            data-testid="business-gallery-thumb"
          >
            <img
              src={p.thumbUrl ?? p.url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>

      <Modal open={open} onOpenChange={setOpen} size="lg" title={t('title')}>
        <div className="flex flex-col items-center gap-3">
          <img
            src={current.url}
            alt=""
            className="max-h-[70vh] w-auto object-contain"
            data-testid="business-gallery-lightbox-img"
          />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={goPrev}
              aria-label={t('prev')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text hover:border-primary"
              data-testid="business-gallery-prev"
            >
              {prevChevron}
            </button>
            <span className="text-sm tabular-nums text-muted" data-testid="business-gallery-count">
              {t('count', { i: index + 1, n: count })}
            </span>
            <button
              type="button"
              onClick={goNext}
              aria-label={t('next')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text hover:border-primary"
              data-testid="business-gallery-next"
            >
              {nextChevron}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
