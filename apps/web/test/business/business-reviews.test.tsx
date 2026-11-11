// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { Review, PageMeta } from '@app/contracts';

/**
 * F4.4 BusinessReviews — summary + distribution + client-side filters +
 * load-more. The initial reviews page is passed as props (the aggregate's
 * first page); `apiFetch` is mocked so load-more returns a synthetic page 2.
 */
import type { BusinessReviewsProps } from '../../src/components/business/business-reviews';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));
// ReviewItem now renders the F4.6 actions (vote/report/reply), which call
// useAuth — stub it as a non-owner authenticated user so the static reply
// display path is taken and the actions render enabled.
vi.mock('../../src/lib/auth/auth-context', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'u-other' } }),
}));

const { BusinessReviews } = await import('../../src/components/business/business-reviews');

const messages = {
  ui: { rating: { label: 'امتیاز {value} از {max}', star: '{value} ستاره' } },
  businessPage: {
    reviews: {
      title: 'نظرات',
      basedOn: 'بر اساس {count} نظر',
      avgRating: 'میانگین',
      filters: {
        sort: 'مرتب‌سازی',
        newest: 'جدیدترین',
        helpful: 'کاربردی‌ترین',
        highRating: 'بالاترین',
        lowRating: 'پایین‌ترین',
        verifiedOnly: 'تأییدشده',
        withPhoto: 'با عکس',
        clear: 'حذف',
      },
      item: {
        helpful: 'کاربردی',
        unhelpful: 'نکاربردی',
        verified: 'تأییدشده',
        firstReview: 'اولین نظر',
        edited: 'ویرایش‌شده',
        ownerReply: 'پاسخ',
        helpfulCount: '{count} کاربردی',
      },
      loadMore: 'بیشتر',
      noReviews: 'نظری نیست',
      noMatches: 'مطابی نیست',
      authorFallback: 'ناشناس',
      starsLabel: '{n} ستاره',
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
    body: 'بدنه نظر',
    status: 'approved',
    photoUrl: null,
    helpfulCount: 0,
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

// ratings 5/4/2 with createdAt out of rating order so newest ≠ highRating.
const reviews: Review[] = [
  makeReview({
    id: 'r1',
    authorName: 'آلیس',
    rating: 5,
    verified: true,
    photoUrl: '/p.jpg',
    helpfulCount: 3,
    createdAt: '2026-01-01T00:00:00Z',
  }),
  makeReview({
    id: 'r2',
    authorName: 'باب',
    rating: 4,
    verified: false,
    photoUrl: null,
    helpfulCount: 1,
    createdAt: '2026-01-03T00:00:00Z',
  }),
  makeReview({
    id: 'r3',
    authorName: 'کارول',
    rating: 2,
    verified: false,
    photoUrl: null,
    helpfulCount: 0,
    createdAt: '2026-01-02T00:00:00Z',
  }),
];

const meta: PageMeta = { page: 1, pageSize: 20, total: 3, totalPages: 1 };

function renderReviews(over: Partial<BusinessReviewsProps> = {}) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessReviews
        businessId="b1"
        avgRating={4.2}
        reviewCount={3}
        initialReviews={reviews}
        initialMeta={meta}
        {...over}
      />
    </NextIntlClientProvider>,
  );
}

describe('BusinessReviews', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('renders the no-reviews message when reviewCount is 0', () => {
    renderReviews({
      reviewCount: 0,
      initialReviews: [],
      initialMeta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    expect(screen.getByTestId('business-reviews-empty')).toHaveTextContent('نظری نیست');
    expect(screen.queryByTestId('business-reviews-summary')).toBeNull();
  });

  it('renders the summary (avg + count + distribution) and all loaded review items', () => {
    renderReviews();
    expect(screen.getByTestId('business-reviews-summary')).toBeInTheDocument();
    expect(screen.getByTestId('business-reviews-distribution')).toBeInTheDocument();
    expect(screen.getAllByTestId('business-review-item')).toHaveLength(3);
  });

  it('filters to verified-only reviews', () => {
    renderReviews();
    fireEvent.click(screen.getByTestId('business-reviews-verified'));
    const items = screen.getAllByTestId('business-review-item');
    expect(items).toHaveLength(1); // only r1 is verified
    expect(items[0]!).toHaveTextContent('آلیس');
    expect(screen.getAllByTestId('business-review-verified')).toHaveLength(1);
  });

  it('filters to reviews with a photo', () => {
    renderReviews();
    fireEvent.click(screen.getByTestId('business-reviews-photo'));
    expect(screen.getAllByTestId('business-review-item')).toHaveLength(1); // only r1 has a photo
  });

  it('sorts by highest rating (distinct from the newest-first default)', () => {
    renderReviews();
    // default newest first: r2(01-03), r3(01-02), r1(01-01)
    expect(screen.getAllByTestId('business-review-item')[0]!).toHaveTextContent('باب');
    fireEvent.change(screen.getByTestId('business-reviews-sort'), {
      target: { value: 'highRating' },
    });
    // highRating: r1(5), r2(4), r3(2)
    const items = screen.getAllByTestId('business-review-item');
    expect(items[0]!).toHaveTextContent('آلیس');
    expect(items[1]!).toHaveTextContent('باب');
    expect(items[2]!).toHaveTextContent('کارول');
  });

  it('clear-filters restores the full list', () => {
    renderReviews();
    fireEvent.click(screen.getByTestId('business-reviews-verified'));
    expect(screen.getAllByTestId('business-review-item')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('business-reviews-clear'));
    expect(screen.getAllByTestId('business-review-item')).toHaveLength(3);
  });

  it('loads the next page on load-more and appends the reviews', async () => {
    apiFetchMock.mockResolvedValue({
      data: {
        items: [
          makeReview({
            id: 'r4',
            authorName: 'دیوید',
            rating: 1,
            createdAt: '2025-12-01T00:00:00Z',
          }),
        ],
        meta: { page: 2, pageSize: 20, total: 4, totalPages: 2 },
      },
    });
    renderReviews({ initialMeta: { page: 1, pageSize: 20, total: 4, totalPages: 2 } });
    fireEvent.click(screen.getByTestId('business-reviews-loadmore'));
    await waitFor(() => expect(screen.getAllByTestId('business-review-item')).toHaveLength(4));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(String(apiFetchMock.mock.calls[0]![0])).toContain('/businesses/b1/reviews');
  });

  it('renders an owner reply block when the review has one', () => {
    renderReviews({
      initialReviews: [
        makeReview({
          id: 'r-replied',
          authorName: 'سام',
          reply: {
            id: 'rep1',
            reviewId: 'r-replied',
            userId: 'owner1',
            authorName: 'مالک',
            body: 'سپاس از نظر شما',
            editedAt: null,
            createdAt: '2026-01-04T00:00:00Z',
            updatedAt: '2026-01-04T00:00:00Z',
          },
        }),
      ],
      initialMeta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    const reply = screen.getByTestId('business-review-reply');
    expect(reply).toBeInTheDocument();
    expect(reply).toHaveTextContent('سپاس از نظر شما');
  });
});
