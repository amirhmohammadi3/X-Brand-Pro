'use client';

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  /** Accessible name for the group. */
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  className?: string;
}

/**
 * `SegmentedControl` (F1.8). A small radio-group styled as a segmented
 * control — used for the OTP channel (SMS / email) and the register contact
 * choice. Real `role="radio"` buttons inside `role="radiogroup"` with a
 * roving tabindex and Arrow/Home/End keys, so it is fully keyboard operable
 * and screen-reader friendly (DESIGN.md section 9). `dir` is inherited, so
 * the visual order mirrors in RTL while the DOM order stays stable.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onValueChange,
  options,
  className,
}: SegmentedControlProps<T>) {
  const groupId = useId();

  const selectAndFocus = (target: T) => {
    onValueChange(target);
    // Focus follows selection (radio-group convention).
    const el = document.getElementById(`${groupId}-${target}`) as HTMLButtonElement | null;
    el?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    const current = enabled.findIndex((option) => option.value === value);
    if (current === -1) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (current + 1) % enabled.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    if (target !== undefined) selectAndFocus(target.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex w-full rounded-md bg-surface-alt p-1', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${groupId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'bg-surface text-text shadow-sm'
                : 'bg-transparent text-text-subtle hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
