// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { Badge } from '../../src/components/ui/badge';
import { EmptyState } from '../../src/components/ui/empty-state';
import { ErrorState } from '../../src/components/ui/error-state';
import { Inbox } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import { ApiRequestError } from '../../src/lib/api/errors';

const fa = {
  ui: {
    loading: 'در حال بارگذاری',
    retry: 'تلاش دوباره',
    close: 'بستن',
    error: 'خطایی رخ داد',
    requestId: 'شناسه درخواست: {id}',
    rating: { label: 'امتیاز {value} از {max}', inputLabel: 'امتیاز شما', star: '{value} ستاره' },
  },
};

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fa" messages={fa}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Badge (F1.3)', () => {
  it('renders its text content', () => {
    render(<Badge>نکته</Badge>);
    expect(screen.getByText('نکته')).toBeInTheDocument();
  });

  it('always renders text — never empty', () => {
    const { container } = render(<Badge>فعال</Badge>);
    expect(container.textContent).toContain('فعال');
  });

  it('passes axe', async () => {
    const { container } = render(<Badge>ok</Badge>);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('renders a leading icon', () => {
    const { container } = render(<Badge leadingIcon={Inbox}>پستی</Badge>);
    // an svg icon is rendered alongside the text
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('پستی')).toBeInTheDocument();
  });
});

describe('EmptyState (F1.3)', () => {
  it('renders the icon, title and description', () => {
    render(<EmptyState icon={Inbox} title="هنوز چیزی نیست" description="بعداً برگردید." />);
    expect(screen.getByText('هنوز چیزی نیست')).toBeInTheDocument();
    expect(screen.getByText('بعداً برگردید.')).toBeInTheDocument();
  });

  it('renders a primary action button when given', () => {
    render(<EmptyState icon={Inbox} title="x" action={{ label: 'شروع', onClick: () => {} }} />);
    expect(screen.getByRole('button', { name: 'شروع' })).toBeInTheDocument();
  });

  it('passes axe', async () => {
    const { container } = render(<EmptyState icon={Inbox} title="x" description="y" />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});

describe('ErrorState (F1.3)', () => {
  it('renders the message from an ApiRequestError with its request id', () => {
    const err = new ApiRequestError({
      status: 500,
      code: 'INTERNAL' as never,
      message: 'دریافت ناموفق',
      requestId: 'req_abc',
    });
    renderWithIntl(<ErrorState error={err} />);
    expect(screen.getByText('دریافت ناموفق')).toBeInTheDocument();
    expect(screen.getByText('شناسه درخواست: req_abc')).toBeInTheDocument();
  });

  it('renders a plain string message', () => {
    renderWithIntl(<ErrorState error="خطای ساده" />);
    expect(screen.getByText('خطای ساده')).toBeInTheDocument();
  });

  it('renders a retry button when onRetry is provided', () => {
    renderWithIntl(<ErrorState error="x" onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: 'تلاش دوباره' })).toBeInTheDocument();
  });

  it('falls back to the generic error message for unknown errors', () => {
    renderWithIntl(<ErrorState error={new Error('boom')} />);
    expect(screen.getByText('خطایی رخ داد')).toBeInTheDocument();
  });

  it('passes axe', async () => {
    const { container } = renderWithIntl(<ErrorState error="x" onRetry={() => {}} />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
