// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import { Tabs } from '../../src/components/ui/tabs';
import { en } from './messages';

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Tabs (F1.5)', () => {
  it('renders triggers and only the selected panel', () => {
    withIntl(
      <Tabs
        defaultValue="a"
        tabs={[
          { value: 'a', label: 'First', content: <p>first body</p> },
          { value: 'b', label: 'Second', content: <p>second body</p> },
        ]}
      />,
    );
    expect(screen.getByText('first body')).toBeTruthy();
    expect(screen.queryByText('second body')).toBeNull();
  });

  it('marks the active trigger with aria-selected', () => {
    withIntl(
      <Tabs
        defaultValue="a"
        tabs={[
          { value: 'a', label: 'First', content: <p>a</p> },
          { value: 'b', label: 'Second', content: <p>b</p> },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'First' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'false');
  });

  it('ArrowRight moves to the next tab in LTR', async () => {
    const user = userEvent.setup();
    withIntl(
      <Tabs
        defaultValue="a"
        tabs={[
          { value: 'a', label: 'First', content: <p>a</p> },
          { value: 'b', label: 'Second', content: <p>b</p> },
        ]}
      />,
    );
    screen.getByRole('tab', { name: 'First' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveFocus();
  });

  it('clicking a trigger switches the panel', async () => {
    const user = userEvent.setup();
    withIntl(
      <Tabs
        defaultValue="a"
        tabs={[
          { value: 'a', label: 'First', content: <p>first body</p> },
          { value: 'b', label: 'Second', content: <p>second body</p> },
        ]}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByText('second body')).toBeTruthy();
    expect(screen.queryByText('first body')).toBeNull();
  });

  it('passes axe', async () => {
    const { container } = withIntl(
      <Tabs
        defaultValue="a"
        tabs={[
          { value: 'a', label: 'First', content: <p>a</p> },
          { value: 'b', label: 'Second', content: <p>b</p> },
        ]}
      />,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
