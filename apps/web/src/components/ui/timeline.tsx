'use client';

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TimelineItem {
  tone?: 'default' | 'primary' | 'success' | 'danger';
  time?: ReactNode;
  children: ReactNode;
}

export interface TimelineProps {
  items: ReadonlyArray<TimelineItem>;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<TimelineItem['tone']>, string> = {
  default: 'bg-text-subtle',
  primary: 'bg-primary',
  success: 'bg-success',
  danger: 'bg-danger',
};

/**
 * `Timeline` (F1.5). A vertical list of events with a leading dot per item
 * connected by a vertical line on the start edge (logical positioning so it
 * sits on the start edge in both LTR and RTL).
 */
export function Timeline({ items, className }: TimelineProps) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {items.map((item, i) => (
        <li key={i} className="relative flex gap-3 pb-6 last:pb-0">
          {i < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute inset-inline-start-[7px] top-4 bottom-0 w-px bg-border-subtle"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              'mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-surface',
              TONE_CLASS[item.tone ?? 'default'],
            )}
          />
          <div className="flex flex-1 flex-col gap-0.5">
            {item.time ? <span className="text-xs text-text-subtle">{item.time}</span> : null}
            <div className="text-sm text-text">{item.children}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
