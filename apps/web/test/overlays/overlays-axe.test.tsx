// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import {
  Drawer,
  BottomSheet,
  Popover,
  Tooltip,
  Accordion,
  Breadcrumbs,
  Stat,
  Timeline,
  CopyButton,
  Button,
} from '../../src/components/ui';
import { en } from './messages';

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('F1.5 overlays & data — axe + smoke', () => {
  it('Drawer is axe-clean when closed', async () => {
    const { container } = withIntl(
      <Drawer open={false} onOpenChange={() => {}} title="Drawer">
        body
      </Drawer>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('BottomSheet is axe-clean when closed', async () => {
    const { container } = withIntl(
      <BottomSheet open={false} onOpenChange={() => {}} title="Sheet">
        body
      </BottomSheet>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Popover trigger renders and is axe-clean', async () => {
    const { container } = withIntl(<Popover trigger={<Button>open</Button>}>content</Popover>);
    expect(screen.getByRole('button', { name: 'open' })).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Tooltip trigger renders and is axe-clean', async () => {
    const { container } = withIntl(
      <Tooltip content="hint">
        <Button>hover me</Button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'hover me' })).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Accordion renders items and is axe-clean', async () => {
    const { container } = withIntl(
      <Accordion
        items={[
          { value: 'a', header: 'First', content: 'first body' },
          { value: 'b', header: 'Second', content: 'second body' },
        ]}
      />,
    );
    expect(screen.getByText('First')).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Breadcrumbs marks the current page and is axe-clean', async () => {
    const { container } = withIntl(
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'List', href: '/list' },
          { label: 'Current' },
        ]}
      />,
    );
    expect(screen.getByText('Current')).toHaveAttribute('aria-current', 'page');
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Stat renders value and delta label text', async () => {
    const { container } = withIntl(
      <Stat label="Visits" value="1240" delta={12} deltaUnit="percent" />,
    );
    expect(screen.getByText('1240')).toBeTruthy();
    expect(screen.getByText('Increased')).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('Timeline renders items and is axe-clean', async () => {
    const { container } = withIntl(
      <Timeline
        items={[
          { time: 'Today', children: 'Order confirmed.', tone: 'success' },
          { time: 'Yesterday', children: 'Payment received.', tone: 'primary' },
        ]}
      />,
    );
    expect(screen.getByText('Order confirmed.')).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('CopyButton renders with an accessible label and is axe-clean', async () => {
    const { container } = withIntl(<CopyButton value="ABC123" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
