import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { Spinner } from './spinner';

const buttonStyles = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:opacity-90',
        secondary: 'bg-surface-alt text-text border border-border-subtle hover:opacity-90',
        ghost: 'bg-transparent text-text hover:bg-surface-alt',
        danger: 'bg-danger text-on-primary hover:opacity-90',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline px-0',
      },
      size: {
        // Control height follows the active pack's --control-h (F1.2 token).
        sm: 'h-[calc(var(--control-h)*0.85)] px-3 text-sm',
        md: 'h-[var(--control-h)] px-4 text-sm',
        lg: 'h-[calc(var(--control-h)*1.15)] px-6 text-base',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [{ variant: 'link', size: 'sm', class: 'h-auto' }],
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonStyles>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonStyles>['size']>;

// Type-level enforcement (F1.3): an icon-only button (no children) MUST have
// an aria-label. Two overloads route the call based on whether `children` is
// present.
interface ButtonBaseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  asChild?: boolean;
}

interface ButtonWithChildren extends ButtonBaseProps {
  children: React.ReactNode;
  'aria-label'?: string;
}

interface ButtonIconOnly extends ButtonBaseProps {
  children?: never;
  'aria-label': string;
}

export type ButtonProps = ButtonWithChildren | ButtonIconOnly;

function isIconOnly(props: ButtonProps): props is ButtonIconOnly {
  return props.children === undefined || props.children === null;
}

/**
 * `Button` (F1.3). Variants: primary / secondary / ghost / danger / link.
 * Sizes use the active pack's `--control-h`. `loading` keeps the width (the
 * spinner replaces content but the button keeps its inline-block size), sets
 * `aria-busy` and blocks clicks. `asChild` merges props onto a child element
 * (Radix Slot) so a Button can render as a link. Icon-only buttons require an
 * `aria-label` — enforced by the TS overloads above, so a missing label is a
 * type error, not an a11y bug discovered in review.
 */
export function Button(props: ButtonProps) {
  const {
    variant,
    size,
    block,
    loading = false,
    asChild = false,
    className,
    children,
    disabled,
    onClick,
    ...rest
  } = props;

  const iconOnly = isIconOnly(props);
  const Comp = asChild ? Slot : 'button';

  // Prevent clicks while loading (in addition to the disabled attribute, which
  // we also set so keyboard users cannot trigger it).
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  return (
    <Comp
      className={cn(
        buttonStyles({ variant, size, block }),
        iconOnly && 'px-0 aspect-square',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={iconOnly ? props['aria-label'] : rest['aria-label']}
      data-loading={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </Comp>
  );
}
