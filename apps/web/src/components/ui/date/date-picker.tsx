'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as Dialog from '@radix-ui/react-dialog';
import {
  getCalendarSystem,
  dateToIso,
  isoToDate,
  normalizeDigitsToAscii,
} from '../../../lib/calendar/calendar-system';
import { cn } from '../../../lib/cn';
import { Button } from '../button';
import { CalendarGrid } from './calendar-grid';

export interface DatePickerProps {
  value?: string | null; // ISO YYYY-MM-DD
  onChange: (iso: string | null) => void;
  min?: string | null; // ISO
  max?: string | null; // ISO
  disabledDates?: ReadonlyArray<string>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * `DatePicker` (F1.6). A typed input + calendar popover. The typed text is
 * parsed in the ACTIVE calendar (Jalali for `fa`, Gregorian otherwise) and
 * accepts Persian/Arabic/ASCII digits with `/` or `-` separators. The
 * canonical value is always ISO `YYYY-MM-DD` (Gregorian).
 *
 * Keyboard: the grid is a WAI-ARIA `grid`; arrows move by day, PageUp/Down by
 * month, Home/End to week bounds, Enter selects, ESC closes. On mobile (<768px)
 * the calendar opens as a bottom sheet instead of a popover.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabledDates,
  placeholder,
  disabled = false,
  invalid = false,
  clearable = true,
  className,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const locale = useLocale();
  const t = useTranslations('form.date');
  const sys = getCalendarSystem(locale);
  const inputId = useId();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState(false);

  const selectedDate = useMemo(() => (value ? isoToDate(value) : null), [value]);
  const minDate = useMemo(() => (min ? isoToDate(min) : null), [min]);
  const maxDate = useMemo(() => (max ? isoToDate(max) : null), [max]);

  const initialView = useMemo(() => {
    const base = selectedDate ?? new Date();
    const parts = sys.fromDate(base);
    return { year: parts.year, month: parts.month };
  }, [sys, selectedDate]);
  const [view, setView] = useState(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const displayPattern = locale === 'fa' ? 'yyyy/MM/dd' : 'yyyy-MM-dd';

  const formatted = useMemo(() => {
    if (!selectedDate) return '';
    return sys.format(selectedDate, displayPattern);
  }, [sys, selectedDate, displayPattern]);

  const parseTyped = useCallback(
    (text: string): Date | null => {
      const ascii = normalizeDigitsToAscii(text).trim();
      if (!ascii) return null;
      const normalized = ascii.replace(/-/g, '/');
      // Try the display pattern first, then the other separator.
      return sys.parse(normalized, 'yyyy/MM/dd') ?? sys.parse(normalized, 'yyyy-MM-dd');
    },
    [sys],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setDraft(text);
    // Try to auto-parse complete dates without blocking typing.
    const parsed = parseTyped(text);
    if (parsed) {
      setDraftError(false);
      // Only commit if it differs from current value.
      if (dateToIso(parsed) !== value) {
        onChange(dateToIso(parsed));
      }
    }
  };

  const handleInputBlur = () => {
    if (draft && draftError) {
      // Reset draft to formatted value on blur if invalid.
      setDraft('');
      setDraftError(false);
    }
  };

  const handlePick = (date: Date) => {
    onChange(dateToIso(date));
    setOpen(false);
  };

  const prevMonth = () => {
    const firstOfMonth = sys.toDate({ year: view.year, month: view.month, day: 1 });
    const prev = sys.addMonths(firstOfMonth, -1);
    const parts = sys.fromDate(prev);
    setView({ year: parts.year, month: parts.month });
  };
  const nextMonth = () => {
    const firstOfMonth = sys.toDate({ year: view.year, month: view.month, day: 1 });
    const next = sys.addMonths(firstOfMonth, 1);
    const parts = sys.fromDate(next);
    setView({ year: parts.year, month: parts.month });
  };

  const triggerBtn = (
    <button
      type="button"
      disabled={disabled}
      aria-label={t('openCalendar')}
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md text-text-subtle',
        'hover:bg-surface-alt hover:text-text',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
      )}
    >
      <CalendarIcon size={16} />
    </button>
  );

  const grid = (
    <CalendarGrid
      viewYear={view.year}
      viewMonth={view.month}
      selected={selectedDate}
      min={minDate}
      max={maxDate}
      disabledDates={disabledDates}
      onPick={handlePick}
      onPrevMonth={prevMonth}
      onNextMonth={nextMonth}
    />
  );

  return (
    <div className={cn('flex w-full items-center gap-1', className)}>
      <div className="relative flex-1">
        <input
          id={inputId}
          type="text"
          dir="ltr"
          inputMode="numeric"
          disabled={disabled}
          aria-label={ariaLabel ?? t('selectDate')}
          aria-invalid={invalid || draftError || undefined}
          placeholder={placeholder ?? t('placeholder')}
          value={focusedOrDraft(draft, formatted)}
          onChange={handleInputChange}
          onFocus={() => setDraft(formatted)}
          onBlur={handleInputBlur}
          className={cn(
            'h-[var(--control-h)] w-full rounded-md border bg-surface px-3 text-start text-text',
            'placeholder:text-text-subtle',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            invalid || draftError ? 'border-danger' : 'border-border',
          )}
        />
        {clearable && value && !disabled ? (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={() => {
              onChange(null);
              setDraft('');
            }}
            className="absolute end-9 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {/* The calendar trigger (shared). aria-haspopup signals it opens a dialog. */}
      {triggerBtn}

      {/* Desktop: popover (controlled; no Radix Trigger so the same button works for both). */}
      <PopoverPrimitive.Root open={open && !isMobile()} onOpenChange={setOpen}>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            sideOffset={6}
            className={cn(
              'z-50 w-80 rounded-md border border-border bg-surface p-3 text-text shadow-md',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
              'hidden md:block',
            )}
          >
            {grid}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      {/* Mobile: bottom sheet */}
      <Dialog.Root open={open && isMobile()} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-black/50',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            )}
          />
          <Dialog.Content
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-xl bg-surface p-4 text-text shadow-xl',
              'pb-[env(safe-area-inset-bottom)]',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
              'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom',
              'md:hidden',
            )}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" />
            <Dialog.Title className="sr-only">{t('selectDate')}</Dialog.Title>
            {grid}
            <Button variant="ghost" className="mt-3 self-end" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

function focusedOrDraft(draft: string, formatted: string): string {
  return draft !== '' ? draft : formatted;
}
