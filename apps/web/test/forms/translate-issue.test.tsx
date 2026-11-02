// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { render, cleanup, screen } from '@testing-library/react';
import { translateIssue } from '../../src/lib/forms/translate-issue';
import { en, fa } from './messages';

// A tiny harness that exposes a root-scoped translator to translateIssue.
function Harness({ issue }: { issue: unknown }) {
  const t = useTranslations();
  const out = translateIssue(t, issue as never);
  return <span data-testid="out">{out}</span>;
}

function renderIssue(issue: unknown, locale: 'en' | 'fa') {
  cleanup();
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
      <Harness issue={issue} />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId('out').textContent ?? '';
}

describe('translateIssue (F1.4)', () => {
  it('resolves a plain validation key string in en', () => {
    expect(renderIssue('validation.required', 'en')).toBe('This field is required.');
  });

  it('resolves a plain validation key string in fa', () => {
    expect(renderIssue('validation.required', 'fa')).toBe('این فیلد الزامی است.');
  });

  it('resolves a parametric key with params in en', () => {
    expect(renderIssue({ message: 'validation.min', params: { min: 8 } }, 'en')).toBe(
      'Must be at least 8 characters.',
    );
  });

  it('resolves a parametric key with params in fa', () => {
    // next-intl interpolates params verbatim; digit Persianization happens at
    // the display layer (PhoneInput/Textarea counter), not in the translator.
    expect(renderIssue({ message: 'validation.min', params: { min: 8 } }, 'fa')).toBe(
      'حداقل 8 نویسه لازم است.',
    );
  });

  it('resolves every validation key in en', () => {
    // Plain keys resolve directly; parametric keys need params.
    const cases: Array<{ key: string; params?: Record<string, unknown> }> = [
      { key: 'validation.required' },
      { key: 'validation.email' },
      { key: 'validation.phone' },
      { key: 'validation.max', params: { max: 10 } },
      { key: 'validation.password', params: { min: 8 } },
      { key: 'validation.username', params: { min: 3, max: 20 } },
      { key: 'validation.match' },
    ];
    for (const c of cases) {
      const out = renderIssue(c.params ? { message: c.key, params: c.params } : c.key, 'en');
      expect(out, `${c.key} should resolve`).toMatch(/\S/);
      expect(out, `${c.key} should not be the raw key`).not.toBe(c.key);
    }
  });

  it('resolves every validation key in fa', () => {
    const cases: Array<{ key: string; params?: Record<string, unknown> }> = [
      { key: 'validation.required' },
      { key: 'validation.email' },
      { key: 'validation.phone' },
      { key: 'validation.min', params: { min: 8 } },
      { key: 'validation.max', params: { max: 10 } },
      { key: 'validation.password', params: { min: 8 } },
      { key: 'validation.username', params: { min: 3, max: 20 } },
      { key: 'validation.match' },
    ];
    for (const c of cases) {
      const out = renderIssue(c.params ? { message: c.key, params: c.params } : c.key, 'fa');
      expect(out, `${c.key} should resolve`).toMatch(/\S/);
      expect(out, `${c.key} should not be the raw key`).not.toBe(c.key);
    }
  });

  it('falls back to the raw key for an unknown key', () => {
    expect(renderIssue('validation.does_not_exist', 'en')).toBe('validation.does_not_exist');
  });

  it('handles the server { key, params } form', () => {
    expect(renderIssue({ key: 'validation.max', params: { max: 10 } }, 'en')).toBe(
      'Must be at most 10 characters.',
    );
  });
});
