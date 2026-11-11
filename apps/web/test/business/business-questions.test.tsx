// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { QaQuestion } from '@app/contracts';

/**
 * F4.7 BusinessQuestions — list (fetched on mount) + ask form (auth-gated) +
 * owner answer form. useAuth + apiFetch + the i18n Link are mocked; apiFetch
 * dispatches by path/method so the mount GET, the POST ask and the PUT answer
 * each answer with the right shape.
 */
import type { BusinessQuestionsProps } from '../../src/components/business/business-questions';

const useAuthMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));
vi.mock('../../src/i18n/navigation', () => ({
  Link: (props: { href: string; children?: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

const { BusinessQuestions } = await import('../../src/components/business/business-questions');

const messages = {
  businessPage: {
    questions: {
      title: 'پرسش و پاسخ',
      count: '{count} پرسش',
      noQuestions: 'پرسشی نیست.',
      askTitle: 'بپرسید',
      askPlaceholder: 'بنویسید…',
      askSubmit: 'ثبت',
      askSubmitting: 'در حال ثبت…',
      askSuccess: 'ثبت شد.',
      askLoginRequired: 'وارد شوید.',
      askLogin: 'ورود',
      answerLabel: 'پاسخ',
      answerPlaceholder: 'بنویسید…',
      answerSubmit: 'ثبت',
      answerSubmitting: 'در حال ثبت…',
      notAnswered: 'پاسخ داده نشده.',
      loadMore: 'بیشتر',
      asker: 'پرسشگر',
      error: 'خطا.',
    },
  },
};

function makeQuestion(over: Partial<QaQuestion> & { id: string }): QaQuestion {
  return {
    businessId: 'b1',
    userId: 'u1',
    authorName: null,
    authorUsername: 'user',
    body: 'پرسش?',
    status: 'approved',
    answer: null,
    editedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const list: QaQuestion[] = [
  makeQuestion({
    id: 'q1',
    authorName: 'سام',
    authorUsername: 'sam',
    body: 'ساعات کاری چیست؟',
    answer: {
      id: 'a1',
      questionId: 'q1',
      userId: 'owner',
      authorName: 'مالک',
      body: '۹ تا ۲۱',
      editedAt: null,
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    },
  }),
  makeQuestion({ id: 'q2', authorUsername: 'leo', body: 'پارکینگ دارید؟' }),
];

function setupApiFetch() {
  apiFetchMock.mockImplementation(
    async (path: string, _schema: unknown, opts?: { method?: string }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'PUT' && String(path).endsWith('/answer')) {
        return {
          data: {
            answer: {
              id: 'a2',
              questionId: 'q2',
              userId: 'owner',
              authorName: 'مالک',
              body: 'بله، پارکینگ رایگان',
              editedAt: null,
              createdAt: '2026-01-03T00:00:00Z',
              updatedAt: '2026-01-03T00:00:00Z',
            },
            created: true,
          },
        };
      }
      if (method === 'POST' && String(path).includes('/questions')) {
        return { data: makeQuestion({ id: 'q-new', body: 'پرسش جدید کاربر' }) };
      }
      // GET list
      return { data: { items: list, meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } } };
    },
  );
}

function renderQuestions(over: Partial<BusinessQuestionsProps> = {}) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessQuestions businessId="b1" initialTotal={2} {...over} />
    </NextIntlClientProvider>,
  );
}

describe('BusinessQuestions', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders the login gate for anonymous visitors', () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'anonymous', user: null });
    renderQuestions();
    const gate = screen.getByTestId('business-questions-gate');
    expect(gate).toHaveTextContent('وارد شوید.');
    expect(gate.querySelector('a')).toHaveAttribute('href', '/login');
  });

  it('fetches the list on mount and renders answered + unanswered questions', async () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u-other' } });
    renderQuestions();
    await waitFor(() => expect(screen.getByTestId('business-questions-list')).toBeInTheDocument());
    expect(screen.getAllByTestId('business-question-item')).toHaveLength(2);
    expect(screen.getByTestId('business-question-answer')).toHaveTextContent('۹ تا ۲۱');
    // non-owner sees the "not answered" note on q2
    expect(screen.getByTestId('business-question-not-answered')).toBeInTheDocument();
  });

  it('submits a new question and shows the success copy', async () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    renderQuestions();
    await waitFor(() => expect(screen.getByTestId('business-questions-list')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('business-questions-ask-input'), {
      target: { value: 'یک پرسش آزمایشی جدید' },
    });
    fireEvent.click(screen.getByTestId('business-questions-ask-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('business-questions-ask-success')).toBeInTheDocument(),
    );
    const askCall = apiFetchMock.mock.calls.find(
      (c) => (c[2] as { method?: string })?.method === 'POST',
    )!;
    expect(askCall[0]).toContain('/businesses/b1/questions');
    expect((askCall[2] as { body: unknown }).body).toEqual({ body: 'یک پرسش آزمایشی جدید' });
  });

  it('owner can answer an unanswered question and the answer appears inline', async () => {
    setupApiFetch();
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'owner' } });
    renderQuestions({ ownerId: 'owner' });
    await waitFor(() => expect(screen.getByTestId('business-questions-list')).toBeInTheDocument());
    // q2 (unanswered) shows the answer form
    const input = screen.getByTestId('business-question-answer-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'پاسخ مالک به پرسش' } });
    fireEvent.click(screen.getByTestId('business-question-answer-submit'));
    await waitFor(() => expect(screen.getAllByTestId('business-question-answer')).toHaveLength(2));
    const answers = screen.getAllByTestId('business-question-answer');
    expect(answers[1]!).toHaveTextContent('بله، پارکینگ رایگان');
    const putCall = apiFetchMock.mock.calls.find(
      (c) => (c[2] as { method?: string })?.method === 'PUT',
    )!;
    expect(putCall[0]).toBe('/questions/q2/answer');
  });
});
