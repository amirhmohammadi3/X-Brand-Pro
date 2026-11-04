'use client';

import { useEffect } from 'react';

/**
 * `HeroHeaderMarker` (F1.7). Pages with a hero opt into the transparent
 * header by rendering this marker somewhere in their tree. On mount it sets
 * `document.documentElement.dataset.header = 'transparent'`; on unmount it
 * restores the default `'solid'`. This keeps the luxe pack working on pages
 * without a hero (default solid).
 */
export function HeroHeaderMarker() {
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.dataset.header ?? 'solid';
    html.dataset.header = 'transparent';
    return () => {
      html.dataset.header = previous;
    };
  }, []);
  return null;
}
