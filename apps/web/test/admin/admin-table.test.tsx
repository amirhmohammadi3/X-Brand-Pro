// @vitest-environment jsdom
/**
 * AdminTable component tests (F2.1). The shared admin list chrome composes
 * the F1.5 DataTable with a toolbar slot, an error/retry surface and a
 * server-side pagination footer. Covered here:
 *  - rows render through the column `cell` functions;
 *  - the toolbar slot renders;
 *  - the footer shows the total in Persian digits and clicking "next" emits
 *    the next page;
 *  - loading shows the polite loading status;
 *  - an error shows the alert + retry button wired to `onRetry`;
 *  - empty rows show the custom empty title.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import faSeed from '../../src/i18n/fallback/fa.json';
import { AdminTable, type AdminTableProps } from '../../src/components/admin/admin-table';
import { Button } from '../../src/components/ui/button';

vi.mock('@/i18n/navigation', async () => {
  const React = await import('react');
  type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string };
  const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
    { href, children, ...rest },
    _ref,
  ) {
    return React.createElement('a', { href, ...rest }, children);
  });
  return { Link, usePathname: () => '/fa/admin', useRouter: () => ({}) };
});

interface Row {
  id: string;
  name: string;
  active: boolean;
}

const ROWS: Row[] = [
  { id: 'a', name: 'تهران', active: true },
  { id: 'b', name: 'مشهد', active: false },
];

const COLUMNS: AdminTableProps<Row>['columns'] = [
  { id: 'name', header: 'نام', cell: (r) => r.name },
  { id: 'active', header: 'فعال', cell: (r) => (r.active ? 'بله' : 'خیر') },
];

type RowProps = AdminTableProps<Row>;

function renderTable(props: Partial<RowProps> = {}) {
  const onPageChange = vi.fn();
  render(
    <NextIntlClientProvider locale="fa" messages={faSeed}>
      <AdminTable<Row>
        columns={COLUMNS}
        rows={ROWS}
        total={42}
        loading={false}
        error={null}
        page={1}
        pageSize={20}
        onPageChange={onPageChange}
        rowKey={(r) => r.id}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onPageChange };
}

describe('AdminTable', () => {
  it('renders rows through the column cell functions', () => {
    renderTable();
    expect(screen.getByText('تهران')).toBeInTheDocument();
    expect(screen.getByText('مشهد')).toBeInTheDocument();
    expect(screen.getByText('بله')).toBeInTheDocument();
    expect(screen.getByText('خیر')).toBeInTheDocument();
  });

  it('renders the toolbar slot', () => {
    renderTable({ toolbar: <Button>افزودن</Button> });
    expect(screen.getByText('افزودن')).toBeInTheDocument();
  });

  it('shows the total with Persian digits in the footer', () => {
    renderTable();
    // toDisplayDigits('42', 'fa') → ۴۲; message: «{count} مورد»
    expect(screen.getByText('۴۲ مورد')).toBeInTheDocument();
  });

  it('next-page click emits page 2', () => {
    const { onPageChange } = renderTable();
    // Pagination renders an LTR and an RTL chevron pair (hidden by CSS in
    // the real browser); both share the label and the handler.
    const next = screen.getAllByRole('button', { name: 'صفحه بعد' });
    const nextButton = next[0];
    expect(nextButton).toBeDefined();
    if (nextButton === undefined) return;
    fireEvent.click(nextButton);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('previous page is disabled on the first page', () => {
    renderTable();
    for (const prev of screen.getAllByRole('button', { name: 'صفحه قبل' })) {
      expect(prev).toBeDisabled();
    }
  });

  it('loading shows the polite loading status instead of rows', () => {
    renderTable({ rows: undefined, total: undefined, loading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('تهران')).toBeNull();
  });

  it('an error shows the alert and retry wired to onRetry', () => {
    const onRetry = vi.fn();
    renderTable({ error: 'boom', onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('تهران')).toBeNull();
  });

  it('empty rows show the custom empty title', () => {
    renderTable({ rows: [], total: 0, emptyTitle: 'هنوز موردی ثبت نشده است' });
    expect(screen.getByText('هنوز موردی ثبت نشده است')).toBeInTheDocument();
  });

  it('empty rows fall back to the shared table empty message', () => {
    renderTable({ rows: [], total: 0 });
    expect(screen.getByText('نتیجه‌ای یافت نشد.')).toBeInTheDocument();
  });
});
