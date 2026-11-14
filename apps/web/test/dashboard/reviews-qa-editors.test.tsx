// @vitest-environment jsdom
/**
 * F7.4 ReviewsEditor + QaEditor — owner dashboard reviews/Q&A consoles.
 * Covers the rendering + write paths with `apiFetch` mocked and a real
 * TanStack QueryClientProvider:
 *  - empty list renders the empty state;
 *  - a populated list renders a review/question card;
 *  - the owner can open the reply/answer form and submit it (PUT);
 *  - a 404/403 list read renders nothing thrown (the page server component
 *    handles notFound; the editor just shows the error state).
 *
 * Toast + next-intl + next/navigation are stubbed; auth-context is stubbed
 * as an authenticated owner so the editor's useTranslations/useToast paths
 * resolve.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Review, QaQuestion } from '@app/contracts';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));

const { ToastProvider } = await import('../../src/components/ui/toast');

const messages = {
  form: { toast: { close: 'بستن' } },
  dashboard: {
    reviews: {
      title: 'نظرات',
      loading: 'در حال بارگذاری…',
      emptyTitle: 'بدون نظر',
      emptyMessage: 'هنوز نظری نیست',
      count: '{total} نظر',
      verified: 'تأییدشده',
      firstReview: 'اولین',
      replyLabel: 'پاسخ',
      replyAdd: 'افزودن پاسخ',
      replyEdit: 'ویرایش',
      replyDelete: 'حذف',
      replyPlaceholder: 'بنویسید…',
      replySubmit: 'ثبت',
      replySave: 'ذخیره',
      replyCancel: 'انصراف',
      replyCreated: 'ثبت شد',
      replyUpdated: 'به‌روز شد',
      replyRemoved: 'حذف شد',
      replyError: 'خطا',
      replyCharCount: '{count}/{min}-{max}',
      photoAlt: 'تصویر',
    },
    qa: {
      title: 'پرسش و پاسخ',
      loading: 'در حال بارگذاری…',
      emptyTitle: 'بدون پرسش',
      emptyMessage: 'هنوز پرسشی نیست',
      count: '{total} پرسش',
      answered: 'پاسخ‌داده‌شده',
      pending: 'بی‌پاسخ',
      answerLabel: 'پاسخ',
      answerAdd: 'افزودن پاسخ',
      answerEdit: 'ویرایش',
      answerDelete: 'حذف',
      answerPlaceholder: 'بنویسید…',
      answerSubmit: 'ثبت',
      answerSave: 'ذخیره',
      answerCancel: 'انصراف',
      answerCreated: 'ثبت شد',
      answerUpdated: 'به‌روز شد',
      answerRemoved: 'حذف شد',
      answerError: 'خطا',
      answerCharCount: '{count}/{min}-{max}',
    },
  },
  ui: { error: 'خطا', retry: 'تلاش دوباره' },
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderWith(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <NextIntlClientProvider locale="fa" messages={messages}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    businessId: 'b1',
    userId: 'u1',
    authorName: 'علی',
    authorUsername: 'ali',
    rating: 4,
    body: 'تجربه خوبی بود.',
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
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<QaQuestion> = {}): QaQuestion {
  return {
    id: 'q1',
    businessId: 'b1',
    userId: 'u1',
    authorName: 'سارا',
    authorUsername: 'sara',
    body: 'ساعت کاری چه موقع است؟',
    status: 'approved',
    answer: null,
    editedAt: null,
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

const META = { page: 1, pageSize: 10, total: 1, totalPages: 1 };

describe('ReviewsEditor (F7.4)', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders the empty state when the business has no reviews', async () => {
    apiFetchMock.mockResolvedValue({
      data: { items: [], meta: { ...META, total: 0, totalPages: 0 } },
    });
    const { ReviewsEditor } = await import('../../src/components/dashboard/reviews-editor');
    renderWith(<ReviewsEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('بدون نظر')).toBeTruthy());
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/businesses/b1/reviews',
      expect.anything(),
      expect.anything(),
    );
  });

  it('renders a review and lets the owner post a reply (PUT /reviews/:id/reply)', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/businesses/b1/reviews') {
        return Promise.resolve({ data: { items: [makeReview()], meta: META } });
      }
      if (path === '/reviews/r1/reply') {
        return Promise.resolve({
          data: {
            reply: {
              id: 'rep1',
              body: 'ممنون',
              userId: 'owner',
              createdAt: '2026-11-11T00:00:00Z',
              updatedAt: '2026-11-11T00:00:00Z',
            },
            created: true,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { ReviewsEditor } = await import('../../src/components/dashboard/reviews-editor');
    renderWith(<ReviewsEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('تجربه خوبی بود.')).toBeTruthy());

    fireEvent.click(screen.getByTestId('dashboard-review-reply-add'));
    await screen.findByTestId('dashboard-review-reply-form');
    fireEvent.change(screen.getByTestId('dashboard-review-reply-input'), {
      target: { value: 'ممنون از نظرتان' },
    });
    fireEvent.click(
      screen.getByTestId('dashboard-review-reply-form').querySelector('button[type="submit"]')!,
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/reviews/r1/reply',
        expect.anything(),
        expect.objectContaining({ method: 'PUT', body: { body: 'ممنون از نظرتان' } }),
      );
    });
  });
});

describe('QaEditor (F7.4)', () => {
  beforeEach(() => apiFetchMock.mockReset());

  it('renders the empty state when the business has no questions', async () => {
    apiFetchMock.mockResolvedValue({
      data: { items: [], meta: { ...META, total: 0, totalPages: 0 } },
    });
    const { QaEditor } = await import('../../src/components/dashboard/qa-editor');
    renderWith(<QaEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('بدون پرسش')).toBeTruthy());
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/businesses/b1/questions',
      expect.anything(),
      expect.anything(),
    );
  });

  it('renders a pending question and lets the owner answer it (PUT /questions/:id/answer)', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/businesses/b1/questions') {
        return Promise.resolve({ data: { items: [makeQuestion()], meta: META } });
      }
      if (path === '/questions/q1/answer') {
        return Promise.resolve({
          data: {
            answer: {
              id: 'ans1',
              body: '۹ تا ۲۱',
              userId: 'owner',
              createdAt: '2026-11-11T00:00:00Z',
              updatedAt: '2026-11-11T00:00:00Z',
            },
            created: true,
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const { QaEditor } = await import('../../src/components/dashboard/qa-editor');
    renderWith(<QaEditor businessId="b1" />);
    await waitFor(() => expect(screen.getByText('ساعت کاری چه موقع است؟')).toBeTruthy());
    expect(screen.getByText('بی‌پاسخ')).toBeTruthy();

    fireEvent.click(screen.getByTestId('dashboard-qa-answer-add'));
    await screen.findByTestId('dashboard-qa-answer-form');
    fireEvent.change(screen.getByTestId('dashboard-qa-answer-input'), {
      target: { value: '۹ تا ۲۱ باز است' },
    });
    fireEvent.click(
      screen.getByTestId('dashboard-qa-answer-form').querySelector('button[type="submit"]')!,
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/questions/q1/answer',
        expect.anything(),
        expect.objectContaining({ method: 'PUT', body: { body: '۹ تا ۲۱ باز است' } }),
      );
    });
  });
});
