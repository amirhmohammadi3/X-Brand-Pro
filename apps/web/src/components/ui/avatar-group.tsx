import { cn } from '../../lib/cn';
import { Avatar, type AvatarProps } from './avatar';

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  avatars: Array<Pick<AvatarProps, 'src' | 'name' | 'alt'>>;
  size?: AvatarProps['size'];
  /** Maximum number of avatars to render; the rest collapse into a "+N". */
  max?: number;
}

/**
 * `AvatarGroup` (F1.3). Overlapping stack of avatars; when `max` is exceeded
 * the overflow collapses into a `+N` counter avatar. The overlap uses logical
 * `-ms-3` so RTL order is correct.
 */
export function AvatarGroup({
  avatars,
  size = 'md',
  max = 5,
  className,
  ...rest
}: AvatarGroupProps) {
  const shown = avatars.slice(0, max);
  const overflow = avatars.length - shown.length;
  return (
    <div className={cn('flex items-center', className)} {...rest}>
      {shown.map((a, i) => (
        <Avatar
          key={i}
          src={a.src}
          name={a.name}
          alt={a.alt}
          size={size}
          className={cn('border-2 border-surface', i > 0 && '-ms-3')}
        />
      ))}
      {overflow > 0 ? (
        <Avatar
          name={`+${overflow}`}
          size={size}
          className={cn('border-2 border-surface -ms-3 bg-surface-alt text-muted')}
          aria-label={`${overflow} more`}
        />
      ) : null}
    </div>
  );
}
