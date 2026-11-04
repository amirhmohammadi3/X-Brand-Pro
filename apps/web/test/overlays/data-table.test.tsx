// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { DataTable, type DataTableColumn } from '../../src/components/ui/data-table';
import { en } from './messages';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { id: 'city', header: 'City', cell: () => 'Tehran' },
];

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('DataTable (F1.5)', () => {
  it('renders rows', () => {
    withIntl(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('shows the empty state when there are no rows', () => {
    withIntl(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText('No results found.')).toBeTruthy();
  });

  it('renders a loading announcement when loading', () => {
    withIntl(
      <DataTable columns={columns} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} />,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows the error slot (message + retry) when error is set', () => {
    withIntl(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        error="boom"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('announces sort with aria-sort and calls onSortChange on click', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    withIntl(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onSortChange={onSortChange} />,
    );
    const nameTh = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameTh).toHaveAttribute('aria-sort', 'none');
    const sortBtn = screen.getByRole('button', { name: 'Sort ascending' });
    await user.click(sortBtn);
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'name', dir: 'asc' });
  });

  it('selects all rows via the header checkbox', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const { container } = withIntl(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        selectable
        onSelectionChange={onSelectionChange}
      />,
    );
    const headerBox = container.querySelectorAll('input[type="checkbox"]')[0]!;
    await user.click(headerBox);
    expect(onSelectionChange).toHaveBeenCalledWith(['1', '2']);
  });

  it('renders mobile cards when renderMobileCard is provided', () => {
    withIntl(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        renderMobileCard={(r) => <div>card-{r.name}</div>}
      />,
    );
    expect(screen.getAllByText(/card-/).length).toBeGreaterThan(0);
  });
});
