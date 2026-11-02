// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { Field, Input } from '../../src/components/ui/form';
import { en } from './messages';

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Field aria wiring (F1.4)', () => {
  it('links label, hint and control via id + aria-describedby', () => {
    const { container } = renderWithIntl(
      <Field name="email" label="Email" hint="We never share">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = container.querySelector('input')!;
    const id = input.id;
    expect(id).toBeTruthy();
    // label htmlFor points at the input id
    expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy();
    // aria-describedby points at the hint id
    expect(input.getAttribute('aria-describedby')).toBe(`${id}-hint`);
  });

  it('sets aria-invalid and switches describedby to the error when an error is present', () => {
    const { container } = renderWithIntl(
      <Field name="email" label="Email" error="Invalid">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-error`);
  });

  it('announces the error with role=alert + aria-live=polite', () => {
    const { container } = renderWithIntl(
      <Field name="email" label="Email" error="Invalid">
        {() => <Input />}
      </Field>,
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert).toHaveAttribute('aria-live', 'polite');
    expect(alert?.textContent).toBe('Invalid');
  });

  it('tags the control with data-field-name', () => {
    const { container } = renderWithIntl(
      <Field name="email" label="Email">
        {(p) => <Input {...p} />}
      </Field>,
    );
    expect(container.querySelector('input')!).toHaveAttribute('data-field-name', 'email');
  });

  it('passes axe', async () => {
    const { container } = renderWithIntl(
      <Field name="email" label="Email" hint="hint" error="bad">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
