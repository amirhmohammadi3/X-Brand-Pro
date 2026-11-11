'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { apiFetch } from '@/lib/api/client';
import { createFormatters } from '@/lib/format';
import {
  qaListResultSchema,
  qaQuestionSchema,
  upsertQaAnswerResultSchema,
  type QaQuestion,
} from '@app/contracts';

/**
 * Business Q&A section (F4.7). The B4.9 aggregate carries only the approved
 * question COUNT (`questions.total`); the list itself is fetched client-side
 * from `GET /businesses/:id/questions` (B4.8 — approved questions with their
 * answer joined inline). An authenticated visitor may ask
 * (`POST /businesses/:id/questions`); the business owner may answer an
 * unanswered question (`PUT /questions/:id/answer`, one-per-question upsert).
 * New questions are `pending` (B4.8) → the ask success copy explains they
 * appear once approved, so no list prepend.
 *
 * Client component: list loading + the ask/answer forms are interactive.
 */
export interface BusinessQuestionsProps {
  businessId: string;
  ownerId?: string | null;
  initialTotal: number;
}

export function BusinessQuestions({ businessId, ownerId, initialTotal }: BusinessQuestionsProps) {
  const t = useTranslations('businessPage.questions');
  const locale = useLocale();
  const { formatNumber, formatRelative } = createFormatters(locale);
  const { status, user } = useAuth();

  const [items, setItems] = useState<QaQuestion[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [askBody, setAskBody] = useState('');
  const [asking, setAsking] = useState(false);
  const [askSuccess, setAskSuccess] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [answerBodies, setAnswerBodies] = useState<Record<string, string>>({});
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  const isOwner = ownerId != null && user?.id === ownerId;

  async function fetchPage(next: number) {
    try {
      const { data } = await apiFetch(`/businesses/${businessId}/questions`, qaListResultSchema, {
        query: { page: next, pageSize: 20 },
      });
      setItems((prev) => (next === 1 ? data.items : [...prev, ...data.items]));
      setPage(data.meta.page);
      setTotalPages(data.meta.totalPages);
      setTotal(data.meta.total);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPage(1);
  }, [businessId]);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (askBody.trim().length < 10 || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      await apiFetch(`/businesses/${businessId}/questions`, qaQuestionSchema, {
        method: 'POST',
        body: { body: askBody.trim() },
      });
      setAskSuccess(true);
      setAskBody('');
    } catch {
      setAskError(t('error'));
    } finally {
      setAsking(false);
    }
  }

  async function onAnswer(qid: string, e: React.FormEvent) {
    e.preventDefault();
    const body = (answerBodies[qid] ?? '').trim();
    if (body.length < 2 || answeringId !== null) return;
    setAnsweringId(qid);
    try {
      const { data } = await apiFetch(`/questions/${qid}/answer`, upsertQaAnswerResultSchema, {
        method: 'PUT',
        body: { body },
      });
      setItems((prev) => prev.map((q) => (q.id === qid ? { ...q, answer: data.answer } : q)));
      setAnswerBodies((prev) => {
        const next = { ...prev };
        delete next[qid];
        return next;
      });
    } catch {
      // leave the textarea as-is for a retry
    } finally {
      setAnsweringId(null);
    }
  }

  const hasMore = page > 0 && page < totalPages;
  const canAsk = askBody.trim().length >= 10 && !asking;

  return (
    <div className="flex flex-col gap-4" data-testid="business-questions">
      {/* ask form (auth-gated) */}
      {status === 'loading' ? null : status === 'anonymous' ? (
        <div
          className="rounded-lg border border-border-subtle bg-surface-alt p-4 text-center"
          data-testid="business-questions-gate"
        >
          <p className="text-sm text-muted">{t('askLoginRequired')}</p>
          <Link
            href="/login"
            className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
          >
            {t('askLogin')}
          </Link>
        </div>
      ) : askSuccess ? (
        <div
          className="rounded-lg border border-border-subtle bg-surface-alt p-4"
          data-testid="business-questions-ask-success"
        >
          <p className="text-sm text-text">{t('askSuccess')}</p>
        </div>
      ) : (
        <form
          onSubmit={onAsk}
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
          data-testid="business-questions-ask-form"
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text">{t('askTitle')}</span>
            <textarea
              value={askBody}
              onChange={(e) => setAskBody(e.target.value)}
              placeholder={t('askPlaceholder')}
              minLength={10}
              maxLength={500}
              rows={2}
              className="rounded border border-border-subtle bg-surface px-3 py-2 text-sm"
              data-testid="business-questions-ask-input"
            />
          </label>
          {askError ? (
            <p className="text-xs text-danger" data-testid="business-questions-ask-error">
              {askError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canAsk}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-60"
            data-testid="business-questions-ask-submit"
          >
            {asking ? t('askSubmitting') : t('askSubmit')}
          </button>
        </form>
      )}

      {/* count */}
      <p className="text-sm text-muted">{t('count', { count: formatNumber(total) })}</p>

      {/* list */}
      {loading ? (
        <p className="text-sm text-muted" data-testid="business-questions-loading">
          {t('noQuestions')}
        </p>
      ) : loadError ? (
        <p className="text-sm text-muted">{t('error')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="business-questions-empty">
          {t('noQuestions')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="business-questions-list">
          {items.map((q) => (
            <li
              key={q.id}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
              data-testid="business-question-item"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-text">{q.body}</p>
                <span className="text-xs text-muted">
                  {t('asker')}: {q.authorName ?? q.authorUsername} · {formatRelative(q.createdAt)}
                </span>
              </div>
              {q.answer ? (
                <div
                  className="rounded-lg border-s-2 border-primary bg-surface-alt p-3 text-sm"
                  data-testid="business-question-answer"
                >
                  <p className="text-xs font-semibold text-primary">{t('answerLabel')}</p>
                  <p className="mt-1 text-text">{q.answer.body}</p>
                </div>
              ) : isOwner ? (
                <form
                  onSubmit={(e) => onAnswer(q.id, e)}
                  className="flex flex-col gap-2"
                  data-testid="business-question-answer-form"
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-sm text-text">{t('answerLabel')}</span>
                    <textarea
                      value={answerBodies[q.id] ?? ''}
                      onChange={(e) =>
                        setAnswerBodies((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder={t('answerPlaceholder')}
                      minLength={2}
                      maxLength={1000}
                      rows={2}
                      className="rounded border border-border-subtle bg-surface px-2 py-1 text-sm"
                      data-testid="business-question-answer-input"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={(answerBodies[q.id] ?? '').trim().length < 2 || answeringId !== null}
                    className="self-start rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-on-primary disabled:opacity-60"
                    data-testid="business-question-answer-submit"
                  >
                    {answeringId === q.id ? t('answerSubmitting') : t('answerSubmit')}
                  </button>
                </form>
              ) : (
                <p className="text-xs text-muted" data-testid="business-question-not-answered">
                  {t('notAnswered')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fetchPage(page + 1)}
            className="rounded-lg border border-border-subtle bg-surface px-4 py-2 text-sm text-text hover:border-primary"
            data-testid="business-questions-loadmore"
          >
            {t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
