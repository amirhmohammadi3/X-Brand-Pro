import type { CategoryIcon, CategoryAccent } from '@app/contracts';

/**
 * Category icon rendering (F3.3) — contracts allow-list kebab-case Lucide
 * names (`coffee`, `ice-cream`, …) but lucide-react exports PascalCase, so
 * the resolver converts `ice-cream` → `IceCream` and falls back to a neutral
 * dot for unknown names (never crashes a card grid).
 *
 * `iconComponent(name)` is pure; the accent color uses the category's
 * `color` token when present, else the pack's primary.
 */
import * as Lucide from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const PASCAL_CACHE = new Map<string, LucideIcon | null>();

export function iconComponent(name: string): LucideIcon | null {
  const cached = PASCAL_CACHE.get(name);
  if (cached !== undefined) return cached;
  const pascal = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  const candidate = (Lucide as unknown as Record<string, unknown>)[pascal];
  // Lucide exports ForwardRef components — typeof is 'object' (with a render
  // Symbol), plain functions exist only in old versions. Accept both.
  const resolved =
    typeof candidate === 'function' ||
    (typeof candidate === 'object' && candidate !== null && '$$typeof' in (candidate as object))
      ? (candidate as LucideIcon)
      : null;
  PASCAL_CACHE.set(name, resolved);
  return resolved;
}

/** The theme packs expose ONE accent color (`--color-accent`) — the
 * `accent-1..8` enum is a FUTURE per-accent palette (no per-value CSS var
 * exists yet), so every accent maps to the pack accent today. */
export function accentClass(_accent: CategoryAccent | null | undefined): string {
  void _accent;
  return 'text-accent';
}

export type { CategoryIcon };
