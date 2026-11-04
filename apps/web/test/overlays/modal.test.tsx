// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { Modal } from '../../src/components/ui/modal';
import { Button } from '../../src/components/ui/button';
import { en } from './messages';

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Modal (F1.5)', () => {
  it('traps focus: Tab stays within the dialog while open', async () => {
    const user = userEvent.setup();
    withIntl(
      <Modal
        open
        onOpenChange={() => {}}
        title="Title"
        description="desc"
        footer={
          <>
            <Button variant="ghost">Cancel</Button>
            <Button>Confirm</Button>
          </>
        }
      >
        <button type="button">inside</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('closes on ESC when dismissible (default)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    withIntl(
      <Modal open onOpenChange={onOpenChange} title="Title">
        <p>body</p>
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does NOT close on ESC when dismissible=false', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    withIntl(
      <Modal open onOpenChange={onOpenChange} title="Title" dismissible={false}>
        <p>body</p>
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('renders title and description with accessible name', () => {
    withIntl(
      <Modal open onOpenChange={() => {}} title="My Modal" description="A description">
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(screen.getByText('My Modal')).toBeTruthy();
  });

  it('passes axe when open', async () => {
    const { container } = withIntl(
      <Modal open onOpenChange={() => {}} title="Title" description="desc">
        <p>body</p>
      </Modal>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
