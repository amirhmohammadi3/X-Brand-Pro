// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DatePicker } from '../../src/components/ui/date/date-picker';
import { TimePicker } from '../../src/components/ui/date/time-picker';
import { en, fa } from './messages';

function withIntl(node: React.ReactNode, locale: 'en' | 'fa' = 'en') {
  cleanup();
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('DatePicker (F1.6)', () => {
  it('parses typed ASCII Jalali 1405/01/01 to ISO 2026-03-21 (fa locale)', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<DatePicker value={null} onChange={onChange} />, 'fa');
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1405/01/01' } });
    expect(onChange).toHaveBeenCalledWith('2026-03-21');
  });

  it('parses typed Persian digits ۱۴۰۵/۰۱/۰۱ to ISO 2026-03-21 (fa locale)', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<DatePicker value={null} onChange={onChange} />, 'fa');
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '۱۴۰۵/۰۱/۰۱' } });
    expect(onChange).toHaveBeenCalledWith('2026-03-21');
  });

  it('parses typed Gregorian 2026-03-21 (en locale)', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<DatePicker value={null} onChange={onChange} />, 'en');
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2026-03-21' } });
    expect(onChange).toHaveBeenCalledWith('2026-03-21');
  });

  it('renders the formatted Jalali date in fa locale', () => {
    const { container } = withIntl(<DatePicker value="2026-03-21" onChange={() => {}} />, 'fa');
    const input = container.querySelector('input')!;
    expect((input as HTMLInputElement).value).toBe('1405/01/01');
  });

  it('renders the formatted Gregorian date in en locale', () => {
    const { container } = withIntl(<DatePicker value="2026-03-21" onChange={() => {}} />, 'en');
    const input = container.querySelector('input')!;
    expect((input as HTMLInputElement).value).toBe('2026-03-21');
  });

  it('opens the calendar popover on the trigger button click', () => {
    const { container } = withIntl(<DatePicker value={null} onChange={() => {}} />, 'fa');
    const buttons = container.querySelectorAll('button');
    // The calendar trigger is the icon button with aria-label "Open calendar".
    const trigger = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label') === 'باز کردن تقویم',
    );
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    // The grid role appears (rendered in a portal on document.body).
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('marks the selected day with aria-selected', () => {
    const { container } = withIntl(<DatePicker value="2026-03-21" onChange={() => {}} />, 'fa');
    const buttons = container.querySelectorAll('button');
    const trigger = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label') === 'باز کردن تقویم',
    );
    fireEvent.click(trigger!);
    // The grid is portaled to document.body.
    const selected = document.body.querySelector('[aria-selected="true"]');
    expect(selected).toBeTruthy();
  });

  it('does not let you pick a date below min', () => {
    const onChange = vi.fn();
    const { container } = withIntl(
      // value sets the visible month to 1405/01 (contains 2026-03-21); min blocks it.
      <DatePicker value="2026-03-21" onChange={onChange} min="2026-03-25" />,
      'fa',
    );
    const buttons = container.querySelectorAll('button');
    const trigger = Array.from(buttons).find(
      (b) => b.getAttribute('aria-label') === 'باز کردن تقویم',
    );
    fireEvent.click(trigger!);
    // The grid is portaled to document.body — find the cell for 2026-03-21 (before min).
    const cells = document.body.querySelectorAll('[role="gridcell"]');
    const target = Array.from(cells).find((c) => c.getAttribute('data-cell') === '2026-03-21');
    expect(target).toBeTruthy();
    expect(target!.getAttribute('aria-disabled')).toBe('true');
  });

  it('clears the value via the clear button', () => {
    const onChange = vi.fn();
    const { container } = withIntl(
      <DatePicker value="2026-03-21" onChange={onChange} clearable />,
      'en',
    );
    const clearBtn = container.querySelector('button[aria-label="Clear"]');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn!);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('TimePicker (F1.6)', () => {
  it('parses typed 14:30', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<TimePicker value={null} onChange={onChange} />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '14:30' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('14:30');
  });

  it('parses Persian digits ۱۴:۳۰', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<TimePicker value={null} onChange={onChange} />, 'fa');
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '۱۴:۳۰' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('14:30');
  });

  it('snaps minutes to step=15', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<TimePicker value={null} onChange={onChange} step={15} />);
    const input = container.querySelector('input')!;
    // 14:08 → total 848 → round(848/15)=57 → 855 = 14:15.
    fireEvent.change(input, { target: { value: '14:08' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('14:15');
  });

  it('ArrowUp increases by step', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<TimePicker value="12:00" onChange={onChange} step={30} />);
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('12:30');
  });

  it('rejects invalid input', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<TimePicker value={null} onChange={onChange} />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: '25:99' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is dir=ltr in fa locale', () => {
    const { container } = withIntl(<TimePicker value="12:00" onChange={() => {}} />, 'fa');
    const input = container.querySelector('input')!;
    expect(input.dir).toBe('ltr');
  });
});
