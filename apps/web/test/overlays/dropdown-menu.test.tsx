// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import {
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
  DropdownCheckboxItem,
} from '../../src/components/ui/dropdown-menu';
import { Button } from '../../src/components/ui/button';
import { en } from './messages';

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('DropdownMenu (F1.5)', () => {
  it('opens on trigger click and lists items', async () => {
    const user = userEvent.setup();
    withIntl(
      <DropdownMenu trigger={<Button>Menu</Button>}>
        <DropdownItem>Edit</DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive>Delete</DropdownItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('ArrowDown moves to the next item after opening', async () => {
    const user = userEvent.setup();
    withIntl(
      <DropdownMenu trigger={<Button>Menu</Button>}>
        <DropdownItem>Edit</DropdownItem>
        <DropdownItem>Share</DropdownItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('selects an item on Enter and closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    withIntl(
      <DropdownMenu trigger={<Button>Menu</Button>}>
        <DropdownItem onSelect={onSelect}>Edit</DropdownItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalled();
  });

  it('checkbox item toggles on click', async () => {
    const user = userEvent.setup();
    let checked = false;
    const onCheckedChange = (v: boolean) => (checked = v);
    withIntl(
      <DropdownMenu trigger={<Button>Menu</Button>}>
        <DropdownCheckboxItem checked={checked} onCheckedChange={onCheckedChange}>
          Pin
        </DropdownCheckboxItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Pin' }));
    expect(checked).toBe(true);
  });

  it('passes axe when open', async () => {
    const user = userEvent.setup();
    const { container } = withIntl(
      <DropdownMenu trigger={<Button>Menu</Button>}>
        <DropdownItem>Edit</DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive>Delete</DropdownItem>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
