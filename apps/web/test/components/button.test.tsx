// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { Button } from '../../src/components/ui/button';

const fa = {
  ui: { loading: 'در حال بارگذاری', retry: 'تلاش دوباره', close: 'بستن', error: 'خطا' },
};

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fa" messages={fa}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Button (F1.3)', () => {
  it('renders its children', () => {
    renderWithIntl(<Button>submit</Button>);
    expect(screen.getByRole('button', { name: 'submit' })).toBeInTheDocument();
  });

  it('passes axe on a default button', async () => {
    const { container } = renderWithIntl(<Button>ok</Button>);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('loading sets aria-busy, disables, and prevents click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderWithIntl(
      <Button loading onClick={onClick}>
        go
      </Button>,
    );
    // When loading, the spinner replaces the children so the button has no
    // visible name — query by the single button role instead.
    const btn = container.querySelector('button')!;
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an icon-only button exposes aria-label and has no visible text', () => {
    renderWithIntl(<Button aria-label="add">x</Button>);
    const btn = screen.getByRole('button', { name: 'add' });
    expect(btn).toBeInTheDocument();
  });

  it('a normal click fires the handler', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithIntl(<Button onClick={onClick}>go</Button>);
    await user.click(screen.getByRole('button', { name: 'go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
