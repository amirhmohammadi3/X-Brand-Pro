// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { NumberInput } from '../../src/components/ui/date/number-input';
import { en, fa } from './messages';

/** Stateful wrapper so the controlled value updates across keystrokes. */
function Harness({
  initial,
  onChange,
  ...rest
}: {
  initial: number | null;
  onChange?: (v: number | null) => void;
  [k: string]: unknown;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberInput
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      {...rest}
    />
  );
}

function withIntl(node: ReactNode, locale: 'en' | 'fa' = 'en') {
  cleanup();
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
      {node}
    </NextIntlClientProvider>,
  );
}

/** Simulate focus → type → blur (the parse happens on blur). */
function typeAndBlur(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('NumberInput (F1.6)', () => {
  it('parses ASCII digits with thousands separators to a number', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={null} onChange={onChange} groupThousands />);
    const input = container.querySelector('input')!;
    typeAndBlur(input, '1,234,567');
    expect(onChange).toHaveBeenCalledWith(1234567);
  });

  it('parses Persian digits ۱٬۲۳۴٬۵۶۷ to 1234567', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={null} onChange={onChange} />, 'fa');
    const input = container.querySelector('input')!;
    typeAndBlur(input, '۱٬۲۳۴٬۵۶۷');
    expect(onChange).toHaveBeenCalledWith(1234567);
  });

  it('parses Arabic-Indic digits ١٢٣٤ to 1234', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={null} onChange={onChange} />);
    const input = container.querySelector('input')!;
    typeAndBlur(input, '١٢٣٤');
    expect(onChange).toHaveBeenCalledWith(1234);
  });

  it('empty input yields null', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={123} onChange={onChange} />);
    const input = container.querySelector('input')!;
    typeAndBlur(input, '');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('clamps to min/max', () => {
    const onChange = vi.fn();
    const { container } = withIntl(
      <Harness initial={null} onChange={onChange} min={0} max={100} />,
    );
    const input = container.querySelector('input')!;
    typeAndBlur(input, '150');
    expect(onChange).toHaveBeenCalledWith(100);
  });

  it('ArrowUp increases by step', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={5} onChange={onChange} step={2} />);
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it('ArrowDown decreases by step and clamps to min', () => {
    const onChange = vi.fn();
    const { container } = withIntl(<Harness initial={3} onChange={onChange} step={2} min={0} />);
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('formats the value with locale thousands separators when not focused', () => {
    const { container } = withIntl(<Harness initial={1234567} />);
    const input = container.querySelector('input')!;
    expect((input as HTMLInputElement).value).toMatch(/1[,٫]234[,٫]567/);
  });

  it('shows the Toman unit suffix when currency', () => {
    const { container } = withIntl(
      <Harness initial={3500000} currency aria-label="amount" />,
      'fa',
    );
    expect(container.textContent).toContain('تومان');
  });

  it('always uses dir=ltr on the input (even in fa locale)', () => {
    const { container } = withIntl(<Harness initial={123} aria-label="n" />, 'fa');
    const input = container.querySelector('input')!;
    expect(input.dir).toBe('ltr');
  });
});
