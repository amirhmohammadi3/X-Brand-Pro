// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { Pagination } from '../../src/components/ui/pagination';
import { en, fa } from './messages';

function withIntl(node: React.ReactNode, locale: 'en' | 'fa' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fa' ? fa : en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Pagination (F1.5)', () => {
  it('renders a single-page note when totalPages <= 1', () => {
    withIntl(<Pagination page={1} totalPages={1} onPageChange={() => {}} />);
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
  });

  it('disables prev on page 1 (visible variant)', () => {
    withIntl(<Pagination page={1} totalPages={5} onPageChange={() => {}} />);
    const prev = screen.getAllByRole('button', { name: 'Previous page' })[0]!;
    expect(prev).toBeDisabled();
    const next = screen.getAllByRole('button', { name: 'Next page' })[0]!;
    expect(next).not.toBeDisabled();
  });

  it('marks the active page with aria-current', () => {
    withIntl(<Pagination page={3} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Page 3' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onPageChange on next click', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    withIntl(<Pagination page={3} totalPages={5} onPageChange={onPageChange} />);
    await user.click(screen.getAllByRole('button', { name: 'Next page' })[0]!);
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('shows ellipsis when there are many pages', () => {
    const { container } = withIntl(
      <Pagination page={10} totalPages={20} onPageChange={() => {}} />,
    );
    const ellipsis = container.querySelectorAll('[aria-hidden="true"]');
    expect(ellipsis.length).toBeGreaterThan(0);
  });

  it('renders Persian digits in fa locale', () => {
    withIntl(<Pagination page={2} totalPages={5} onPageChange={() => {}} />, 'fa');
    expect(screen.getByRole('button', { name: 'صفحه ۲' })).toBeTruthy();
  });
});
