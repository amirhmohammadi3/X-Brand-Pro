// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { Review } from '@app/contracts';

/**
 * F4.6 review actions — vote (PUT /reviews/:id/vote), report (POST /reports),
 * owner reply (PUT /reviews/:id/reply). useAuth + apiFetch are mocked; the
 * report Modal (Radix Dialog) renders into a portal so `screen` finds it once
 * open.
 */
const useAuthMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));

const { ReviewVoteButtons, ReviewReportButton, ReviewReplyForm } = await import(
  '../../src/components/business/business-review-actions'
);

const messages = {
  form: { overlay: { close: 'بستن' } },
  businessPage: {
    reviews: {
      actions: {
        helpful: 'کاربردی',
        unhelpful: 'نکاربردی',
        voted: 'ثبت شد',
        report: 'گزارش',
        reportTitle: 'گزارش نظر',
        reportCategory: { spam: 'اسپم', offensive: 'توهین', false_info: 'نادرست', other: 'سایر' },
        reportDetailsLabel: 'توضیحات',
        reportDetailsPlaceholder: 'بنویسید…',
        reportSubmit: 'ثبت',
        reportSuccess: 'ثبت شد.',
        reportLoginRequired: 'وارد شوید.',
        reply: 'پاسخ',
        replyPlaceholder: 'بنویسید…',
        replySubmit: 'ثبت',
        replySubmitting: 'در حال ثبت…',
        replySuccess: 'ثبت شد.',
      },
    },
  },
};

function makeReview(over: Partial<Review> & { id: string }): Review {
  return {
    businessId: 'b1',
    userId: 'u1',
    authorName: null,
    authorUsername: 'user',
    rating: 5,
    body: 'body',
    status: 'approved',
    photoUrl: null,
    helpfulCount: 2,
    unhelpfulCount: 0,
    verified: false,
    checkinVerified: false,
    checkinAt: null,
    receiptUrl: null,
    isFirstReview: false,
    authorLevel: 'newcomer',
    editedAt: null,
    reply: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('ReviewVoteButtons', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders the counts and updates them after a helpful vote', async () => {
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    apiFetchMock.mockResolvedValue({ data: { helpful: 5, unhelpful: 1, myVote: 1 } });
    withIntl(
      <ReviewVoteButtons review={makeReview({ id: 'r1', helpfulCount: 2, unhelpfulCount: 0 })} />,
    );
    const helpful = screen.getByTestId('review-vote-helpful');
    expect(helpful).toHaveTextContent('2');
    fireEvent.click(helpful);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, , opts] = apiFetchMock.mock.calls[0]! as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/reviews/r1/vote');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ value: 1 });
    await waitFor(() => expect(helpful).toHaveTextContent('5'));
    expect(helpful).toHaveAttribute('aria-pressed', 'true');
  });

  it('is disabled for anonymous visitors', () => {
    useAuthMock.mockReturnValue({ status: 'anonymous', user: null });
    withIntl(<ReviewVoteButtons review={makeReview({ id: 'r1' })} />);
    expect((screen.getByTestId('review-vote-helpful') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ReviewReportButton', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders nothing for anonymous visitors', () => {
    useAuthMock.mockReturnValue({ status: 'anonymous', user: null });
    const { container } = withIntl(<ReviewReportButton reviewId="r1" />);
    expect(container.querySelector('[data-testid="review-report"]')).toBeNull();
  });

  it('submits a report with targetType review and the chosen category', async () => {
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    apiFetchMock.mockResolvedValue({ data: { report: { id: 'rep1' } } });
    withIntl(<ReviewReportButton reviewId="r1" />);
    fireEvent.click(screen.getByTestId('review-report'));
    const form = await screen.findByTestId('review-report-form');
    fireEvent.change(withinFormCategory(form), { target: { value: 'spam' } });
    fireEvent.change(screen.getByTestId('review-report-details'), {
      target: { value: 'محتوای تکراری' },
    });
    fireEvent.click(screen.getByTestId('review-report-submit'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, , opts] = apiFetchMock.mock.calls[0]! as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/reports');
    expect(opts.method).toBe('POST');
    expect(opts.body).toMatchObject({
      targetType: 'review',
      targetId: 'r1',
      category: 'spam',
      details: 'محتوای تکراری',
    });
    await waitFor(() => expect(screen.getByTestId('review-report-success')).toBeInTheDocument());
  });
});

// helper: the category <select> lives inside the form
function withinFormCategory(form: HTMLElement): HTMLElement {
  return form.querySelector('[data-testid="review-report-category"]') as HTMLElement;
}

describe('ReviewReplyForm', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('prefills the existing reply and submits an edit', async () => {
    apiFetchMock.mockResolvedValue({ data: { reply: { id: 'rep1' }, created: false } });
    withIntl(
      <ReviewReplyForm
        reviewId="r1"
        existingReply={{
          id: 'rep1',
          reviewId: 'r1',
          userId: 'owner',
          authorName: 'مالک',
          body: 'پاسخ قبلی',
          editedAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        }}
      />,
    );
    const input = screen.getByTestId('review-reply-input') as HTMLTextAreaElement;
    expect(input.value).toBe('پاسخ قبلی');
    fireEvent.change(input, { target: { value: 'پاسخ جدید مالک' } });
    fireEvent.click(screen.getByTestId('review-reply-submit'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, , opts] = apiFetchMock.mock.calls[0]! as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/reviews/r1/reply');
    expect(opts.method).toBe('PUT');
    expect(opts.body).toEqual({ body: 'پاسخ جدید مالک' });
    await waitFor(() => expect(screen.getByTestId('review-reply-success')).toBeInTheDocument());
  });
});
