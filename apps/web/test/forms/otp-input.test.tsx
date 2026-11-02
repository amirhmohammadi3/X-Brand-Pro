// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { OtpInput } from '../../src/components/ui/form/otp-input';
import { en, fa } from './messages';

function renderOtp(props: React.ComponentProps<typeof OtpInput>, locale: 'en' | 'fa' = 'en') {
  const messages = locale === 'fa' ? fa : en;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <OtpInput {...props} />
    </NextIntlClientProvider>,
  );
}

function cells(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
}

describe('OtpInput (F1.4)', () => {
  it('renders exactly `length` cells', () => {
    const { container } = renderOtp({ length: 6, value: '', onChange: () => {} });
    expect(cells(container)).toHaveLength(6);
  });

  it('cells are always laid out LTR (dir=ltr) even in fa locale', () => {
    const { container } = renderOtp({ length: 6, value: '', onChange: () => {} }, 'fa');
    const group = container.querySelector('[dir="ltr"]');
    expect(group).toBeTruthy();
  });

  it('auto-advances focus to the next cell when typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderOtp({ length: 4, value: '', onChange });
    const c0 = cells(container)[0]!,
      c1 = cells(container)[1]!;
    await user.click(c0);
    await user.keyboard('1');
    expect(c1).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  it('pastes a full code into all cells', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderOtp({ length: 6, value: '', onChange });
    const c0 = cells(container)[0]!;
    await user.click(c0);
    await user.paste('123456');
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('normalizes pasted Persian digits to ASCII', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderOtp({ length: 6, value: '', onChange });
    const c0 = cells(container)[0]!;
    await user.click(c0);
    await user.paste('۱۲۳۴۵۶');
    expect(onChange).toHaveBeenLastCalledWith('123456');
  });

  it('backspace on an empty cell moves focus back and clears the previous cell', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderOtp({
      length: 4,
      value: '12  '.trim() ? '12  ' : '',
      onChange,
    });
    const c2 = cells(container)[2]!;
    await user.click(c2);
    await user.keyboard('{Backspace}');
    // The previous cell (index 1) should now be cleared and focused.
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBe('1');
  });

  it('fires onComplete when all cells are filled', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const { container } = renderOtp({
      length: 4,
      value: '',
      onChange: () => {},
      onComplete,
    });
    const c0 = cells(container)[0]!;
    await user.click(c0);
    await user.paste('1234');
    expect(onComplete).toHaveBeenLastCalledWith('1234');
  });

  it('sets aria-invalid on cells when an error is present', () => {
    const { container } = renderOtp({
      length: 4,
      value: '',
      onChange: () => {},
      error: 'bad',
    });
    const c0 = cells(container)[0]!;
    expect(c0).toHaveAttribute('aria-invalid', 'true');
  });

  it('announces the error via a live region', () => {
    const { container } = renderOtp({
      length: 4,
      value: '',
      onChange: () => {},
      error: 'bad',
    });
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('bad');
  });

  it('passes axe', async () => {
    const { container } = renderOtp({ length: 6, value: '', onChange: () => {} });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
