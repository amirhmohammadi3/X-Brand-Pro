'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '../../lib/cn';

export type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

/**
 * Persian-aware initials (F1.3). For a Latin name "Jane Doe" → "JD". For a
 * Persian name we take the first letter of the first two whitespace-separated
 * words, treating a ZWNJ (U+200C) the same as a regular space so compound
 * names like «علی‌رضایی» split correctly:
 *   «علی رضایی»      → «عر»
 *   «علی‌رضا احمدی»  → «عا»
 * Words shorter than one character (e.g. a stray ZWNJ) are skipped.
 */
export function initialsFromName(name: string): string {
  const cleaned = name
    .replace(/\u200c/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ').filter((w) => w.length > 0);
  const firstWord = words[0];
  if (words.length === 1 && firstWord) {
    return firstWord.slice(0, 2);
  }
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? '';
  return first + second;
}

export interface AvatarProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> {
  src?: string;
  alt?: string;
  /** Display name used to compute the fallback initials. */
  name?: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * `Avatar` (F1.3) — Radix Avatar with an image, an image-loading fallback and
 * a name-initials fallback. The initials use the Persian-aware
 * `initialsFromName` helper. `size` scale: sm/md/lg.
 */
export function Avatar({ src, alt = '', name, size = 'md', className, ...rest }: AvatarProps) {
  const fallback = initialsFromName(name ?? alt ?? '');
  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-full bg-surface-alt text-text font-medium select-none',
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={alt} className="h-full w-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback className="flex h-full w-full items-center justify-center">
        {fallback || '?'}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
