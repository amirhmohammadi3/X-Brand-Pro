import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * `DirIcon` — a lucide icon wrapper that mirrors itself in RTL (F1.3).
 *
 * Directional icons (arrows, chevrons) must point the visual way the text
 * flows: in RTL a "next" chevron points left, in LTR right. Rather than pick a // rtl-ok
 * different icon per direction, the same icon is flipped with the logical
 * `rtl:-scale-x-100` variant, so one component works in both directions.
 *
 * `flip` defaults to `true` (most directional icons want flipping); pass
 * `flip={false}` for inherently symmetric icons.
 */
export interface DirIconProps extends React.SVGProps<SVGSVGElement> {
  icon: LucideIcon;
  flip?: boolean;
  className?: string;
}

export function DirIcon({ icon: Icon, flip = true, className, ...rest }: DirIconProps) {
  return <Icon aria-hidden className={cn(flip && 'rtl:-scale-x-100', className)} {...rest} />;
}
