// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider, useToast } from '../../src/components/ui/toast';
import { Button } from '../../src/components/ui/button';
import { en } from './messages';

function Probe({
  message,
  variant = 'success',
  count = 1,
}: {
  message: React.ReactNode;
  variant?: 'success' | 'error' | 'info';
  count?: number;
}) {
  const toast = useToast();
  return (
    <Button
      onClick={() => {
        for (let i = 0; i < count; i++) {
          if (variant === 'error') toast.error(message);
          else if (variant === 'info') toast.info(message);
          else toast.success(message);
        }
      }}
    >
      fire
    </Button>
  );
}

function renderWith(node: React.ReactNode) {
  cleanup();
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ToastProvider>{node}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function fire() {
  fireEvent.click(screen.getByRole('button', { name: 'fire' }));
}

describe('Toast (F1.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('shows a toast on fire', () => {
    renderWith(<Probe message="hello" />);
    act(() => fire());
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('errors use role=alert, success uses role=status', () => {
    renderWith(<Probe message="ok" variant="success" />);
    act(() => fire());
    expect(screen.getByText('ok')).toHaveAttribute('role', 'status');

    renderWith(<Probe message="bad" variant="error" />);
    act(() => fire());
    expect(screen.getByText('bad')).toHaveAttribute('role', 'alert');
  });

  it('auto-dismisses after the duration', () => {
    renderWith(<Probe message="temp" />);
    act(() => fire());
    expect(screen.getByText('temp')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5500);
    });
    expect(screen.queryByText('temp')).toBeNull();
  });

  it('keeps at most 3 visible', () => {
    renderWith(<Probe message="msg" count={5} />);
    act(() => fire());
    // Each toast's title is "Success" (the default variant label); at most 3.
    const titles = screen.getAllByText('Success');
    expect(titles.length).toBeLessThanOrEqual(3);
  });
});
