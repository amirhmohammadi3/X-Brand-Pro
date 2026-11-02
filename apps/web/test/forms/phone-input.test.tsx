// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { PhoneInput } from '../../src/components/ui/form/phone-input';
import { en, fa } from './messages';

function renderPhone(props: React.ComponentProps<typeof PhoneInput>, locale: 'en' | 'fa' = 'en') {
  const messages = locale === 'fa' ? fa : en;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PhoneInput {...props} />
    </NextIntlClientProvider>,
  );
}

describe('PhoneInput (F1.4)', () => {
  it('always renders dir=ltr even in an RTL locale', () => {
    const { container } = renderPhone({ value: '', onValueChange: () => {} }, 'fa');
    expect(container.querySelector('input')!).toHaveAttribute('dir', 'ltr');
  });

  it.each([
    ['0912 345 6789', '+989123456789'],
    ['۰۹۱۲۳۴۵۶۷۸۹', '+989123456789'], // Persian digits
    ['+98 912 345 6789', '+989123456789'],
  ])('normalizes typed input %p to E.164 %p on change', async (typed, expected) => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderPhone({ value: '', onValueChange: onChange });
    const input = container.querySelector('input')!;
    await user.click(input);
    await user.paste(typed);
    // The last onValueChange call should carry the normalized E.164 value.
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBe(expected);
  });

  it('commits the normalized E.164 value on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = renderPhone({ value: '', onValueChange: onChange });
    const input = container.querySelector('input')!;
    await user.click(input);
    await user.paste('0912 345 6789');
    await user.tab();
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last).toBe('+989123456789');
  });

  it('displays the national form with Persian digits in fa locale', () => {
    const { container } = renderPhone({ value: '+989123456789', onValueChange: () => {} }, 'fa');
    expect(container.querySelector('input')!).toHaveValue('۰۹۱۲ ۳۴۵ ۶۷۸۹');
  });

  it('displays the national form with ASCII digits in en locale', () => {
    const { container } = renderPhone({ value: '+989123456789', onValueChange: () => {} }, 'en');
    expect(container.querySelector('input')!).toHaveValue('0912 345 6789');
  });

  it('passes axe', async () => {
    const { container } = renderPhone({ value: '', onValueChange: () => {} });
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('exposes an accessible label', () => {
    renderPhone({ value: '', onValueChange: () => {} });
    // The input has an aria-label from validation.phone.
    expect(screen.getByLabelText('Enter a valid phone number.')).toBeTruthy();
  });
});
