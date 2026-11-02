// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { z } from 'zod';
import { Field, Input, useZodForm } from '../../src/components/ui/form';
import { en } from './messages';

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const schema = z.object({
  email: z.string().email({ message: 'validation.email' }),
  phone: z.string().min(1, { message: 'validation.required' }),
});

type Values = z.infer<typeof schema>;

function TestForm({
  onInject,
}: {
  onInject: (api: ReturnType<typeof useZodForm<Values>>) => void;
}) {
  const form = useZodForm(schema, {
    defaultValues: { email: '', phone: '' },
  });
  const { register, formState } = form;
  return (
    <form onSubmit={form.handleSubmit(() => {})} data-testid="form">
      <Field name="email" label="Email" error={formState.errors.email?.message}>
        {(p) => <Input {...p} {...register('email')} />}
      </Field>
      <Field name="phone" label="Phone" error={formState.errors.phone?.message}>
        {(p) => <Input {...p} {...register('phone')} />}
      </Field>
      <button type="button" onClick={() => onInject(form)}>
        inject
      </button>
    </form>
  );
}

function withProviders(node: React.ReactNode) {
  return (
    <QueryClientProvider client={makeClient()}>
      <NextIntlClientProvider locale="en" messages={en}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe('useZodForm.setServerErrors (F1.4)', () => {
  it('stamps server errors onto the matching fields', async () => {
    render(
      withProviders(
        <TestForm
          onInject={(form) => {
            form.setServerErrors({
              email: ['validation.email'],
              phone: ['validation.required'],
            });
          }}
        />,
      ),
    );
    await userEvent.setup().click(screen.getByText('inject'));
    // The Field renders the raw translation key as the error message text
    // (the playground would translate it; here we assert the stamp landed).
    expect(screen.getByText('validation.email')).toBeTruthy();
    expect(screen.getByText('validation.required')).toBeTruthy();
  });

  it('focuses the first invalid field', async () => {
    const user = userEvent.setup();
    render(
      withProviders(
        <TestForm
          onInject={(form) => {
            form.setServerErrors({
              email: ['validation.email'],
              phone: ['validation.required'],
            });
          }}
        />,
      ),
    );
    await user.click(screen.getByText('inject'));
    // requestAnimationFrame is used to defer focus; flush it.
    await new Promise((r) => setTimeout(r, 50));
    const emailInput = document.querySelector('[data-field-name="email"]') as HTMLInputElement;
    expect(emailInput).toHaveFocus();
  });

  it('fieldErrors can be derived from useApiMutation on an ApiRequestError', async () => {
    const { useApiMutation } = await import('../../src/lib/api/use-api-mutation');
    const { ApiRequestError } = await import('../../src/lib/api/errors');

    let captured: Record<string, unknown> = {};
    function Probe() {
      const m = useApiMutation<unknown, void>(async () => ({}));
      const err = new ApiRequestError({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'bad',
        details: {
          fields: {
            email: ['validation.email'],
            phone: [{ key: 'validation.required' }],
          },
        },
      });
      captured = m.fieldErrors(err);
      return null;
    }
    render(withProviders(<Probe />));
    expect(captured).toEqual({
      email: ['validation.email'],
      phone: [{ key: 'validation.required' }],
    });
  });

  it('returns {} for non-field errors', async () => {
    const { useApiMutation } = await import('../../src/lib/api/use-api-mutation');
    let captured: Record<string, unknown> = {};
    function Probe() {
      const m = useApiMutation<unknown, void>(async () => ({}));
      captured = m.fieldErrors(new Error('not an api error'));
      return null;
    }
    render(withProviders(<Probe />));
    expect(captured).toEqual({});
    void vi;
  });
});
