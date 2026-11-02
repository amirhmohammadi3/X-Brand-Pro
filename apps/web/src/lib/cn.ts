import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` — the single class-name combiner used by every UI component (F1.3).
 *
 * `clsx` handles conditional/arrays/objects; `tailwind-merge` de-duplicates
 * conflicting Tailwind utilities (so `cn('px-2', 'px-4')` → `px-4`). Every
 * component file imports `cn` from here so the merge behavior is uniform and
 * the physical-class ban (check:rtl) is enforced at one chokepoint.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
