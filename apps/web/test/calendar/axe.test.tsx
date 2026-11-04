// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { DatePicker } from '../../src/components/ui/date/date-picker';
import { TimePicker } from '../../src/components/ui/date/time-picker';
import { NumberInput } from '../../src/components/ui/date/number-input';
import { MonthYearJumper } from '../../src/components/ui/date/month-year-jumper';
import { en, fa } from './messages';

function withIntl(node: React.ReactNode, locale: 'en' | 'fa' = 'en') {
  cleanup();
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('F1.6 date/number — axe', () => {
  it('DatePicker (fa, closed) is axe-clean', async () => {
    const { container } = withIntl(<DatePicker value="2026-03-21" onChange={() => {}} />, 'fa');
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('DatePicker (en, closed) is axe-clean', async () => {
    const { container } = withIntl(<DatePicker value="2026-03-21" onChange={() => {}} />, 'en');
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('TimePicker is axe-clean', async () => {
    const { container } = withIntl(
      <TimePicker value="12:00" onChange={() => {}} step={15} />,
      'fa',
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('NumberInput (currency, fa) is axe-clean', async () => {
    const { container } = withIntl(
      <NumberInput value={3500000} onChange={() => {}} currency aria-label="amount" />,
      'fa',
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('MonthYearJumper is axe-clean', async () => {
    const { container } = withIntl(
      <MonthYearJumper value={{ year: 1405, month: 1, day: 1 }} onChange={() => {}} />,
      'fa',
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
