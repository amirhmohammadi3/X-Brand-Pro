'use client';

import { useState } from 'react';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Modal, useModalState } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-context';
import { apiFetch } from '@/lib/api/client';
import {
  reportCategorySchema,
  reportSchema,
  reviewVoteResultSchema,
  upsertReviewReplyResultSchema,
  type ReportCategory,
  type Review,
  type ReviewReply,
} from '@app/contracts';

/**
 * Per-review interactive actions (F4.6): the helpful/unhelpful vote
 * (PUT /reviews/:id/vote — B4.2), the abuse report (POST /reports — B4.4,
 * polymorphic targetType 'review'), and the owner reply form
 * (PUT /reviews/:id/reply — B4.3, one-per-review upsert). The reply DISPLAY
 * for non-owners stays in ReviewItem (F4.4); the owner gets this editable
 * form instead. Vote + report + reply are all user-scoped → auth-gated.
 *
 * Each sub-component owns its own mutation state (a single useApiMutation
 * wrapper would obscure the three distinct contracts); `apiFetch` throws →
 * the catch surfaces a form-level error string.
 */

// ─── Vote ────────────────────────────────────────────────────────────────

export interface ReviewVoteButtonsProps {
  review: Review;
}

export function ReviewVoteButtons({ review }: ReviewVoteButtonsProps) {
  const t = useTranslations('businessPage.reviews');
  const { status } = useAuth();
  const [helpful, setHelpful] = useState(review.helpfulCount);
  const [unhelpful, setUnhelpful] = useState(review.unhelpfulCount);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);
  const disabled = status !== 'authenticated' || voting;

  async function vote(value: 1 | -1) {
    if (disabled) return;
    setVoting(true);
    try {
      const { data } = await apiFetch(`/reviews/${review.id}/vote`, reviewVoteResultSchema, {
        method: 'PUT',
        body: { value },
      });
      setHelpful(data.helpful);
      setUnhelpful(data.unhelpful);
      setMyVote(data.myVote);
    } catch {
      // leave the counts as-is; the button stays clickable for a retry
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="review-vote">
      <button
        type="button"
        onClick={() => vote(1)}
        disabled={disabled}
        aria-pressed={myVote === 1}
        className={`rounded border px-2 py-1 disabled:opacity-60 ${
          myVote === 1 ? 'border-primary text-primary' : 'border-border-subtle text-muted'
        }`}
        data-testid="review-vote-helpful"
      >
        {t('actions.helpful')} ({helpful})
      </button>
      <button
        type="button"
        onClick={() => vote(-1)}
        disabled={disabled}
        aria-pressed={myVote === -1}
        className={`rounded border px-2 py-1 disabled:opacity-60 ${
          myVote === -1 ? 'border-primary text-primary' : 'border-border-subtle text-muted'
        }`}
        data-testid="review-vote-unhelpful"
      >
        {t('actions.unhelpful')} ({unhelpful})
      </button>
    </div>
  );
}

// ─── Report ──────────────────────────────────────────────────────────────

export interface ReviewReportButtonProps {
  reviewId: string;
}

const REPORT_CATEGORIES: ReportCategory[] = ['spam', 'offensive', 'false_info', 'other'];

export function ReviewReportButton({ reviewId }: ReviewReportButtonProps) {
  const t = useTranslations('businessPage.reviews');
  const { status } = useAuth();
  const { open, openModal, closeModal } = useModalState();
  const [category, setCategory] = useState<ReportCategory>('spam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (status !== 'authenticated') return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/reports', z.object({ report: reportSchema }), {
        method: 'POST',
        body: {
          targetType: 'review',
          targetId: reviewId,
          category,
          details: details.trim() === '' ? undefined : details.trim(),
        },
      });
      setSuccess(true);
      setCategory('spam');
      setDetails('');
    } catch {
      setError(t('actions.reportLoginRequired'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-xs text-muted underline underline-offset-2 hover:text-primary"
        data-testid="review-report"
      >
        {t('actions.report')}
      </button>
      <Modal
        open={open}
        onOpenChange={(o) => (o ? openModal() : closeModal())}
        size="sm"
        title={t('actions.reportTitle')}
      >
        {success ? (
          <p className="text-sm text-text" data-testid="review-report-success">
            {t('actions.reportSuccess')}
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3" data-testid="review-report-form">
            <label className="flex flex-col gap-1 text-sm text-text">
              <select
                value={category}
                onChange={(e) => setCategory(reportCategorySchema.parse(e.target.value))}
                className="rounded border border-border-subtle bg-surface px-2 py-1"
                data-testid="review-report-category"
              >
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`actions.reportCategory.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text">
              <span>{t('actions.reportDetailsLabel')}</span>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={t('actions.reportDetailsPlaceholder')}
                rows={3}
                maxLength={1000}
                className="rounded border border-border-subtle bg-surface px-2 py-1"
                data-testid="review-report-details"
              />
            </label>
            {error ? (
              <p className="text-xs text-danger" data-testid="review-report-error">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="self-start rounded-lg bg-primary px-4 py-2 text-sm text-on-primary disabled:opacity-60"
              data-testid="review-report-submit"
            >
              {t('actions.reportSubmit')}
            </button>
          </form>
        )}
      </Modal>
    </>
  );
}

// ─── Owner reply ─────────────────────────────────────────────────────────

export interface ReviewReplyFormProps {
  reviewId: string;
  existingReply: ReviewReply | null;
}

export function ReviewReplyForm({ reviewId, existingReply }: ReviewReplyFormProps) {
  const t = useTranslations('businessPage.reviews');
  const [body, setBody] = useState(existingReply?.body ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 2 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/reviews/${reviewId}/reply`, upsertReviewReplyResultSchema, {
        method: 'PUT',
        body: { body: body.trim() },
      });
      setSuccess(true);
    } catch {
      setError(t('actions.replySubmitting'));
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div
        className="mt-1 rounded-lg border-s-2 border-primary bg-surface-alt p-3 text-sm"
        data-testid="review-reply-success"
      >
        <p className="text-xs font-semibold text-primary">{t('actions.reply')}</p>
        <p className="mt-1 text-text">{body}</p>
        <p className="mt-1 text-xs text-muted">{t('actions.replySuccess')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-2" data-testid="review-reply-form">
      <label className="flex flex-col gap-1 text-sm text-text">
        <span>{t('actions.reply')}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('actions.replyPlaceholder')}
          rows={2}
          minLength={2}
          maxLength={1000}
          className="rounded border border-border-subtle bg-surface px-2 py-1"
          data-testid="review-reply-input"
        />
      </label>
      {error ? (
        <p className="text-xs text-danger" data-testid="review-reply-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={body.trim().length < 2 || submitting}
        className="self-start rounded-lg bg-primary px-4 py-2 text-sm text-on-primary disabled:opacity-60"
        data-testid="review-reply-submit"
      >
        {submitting ? t('actions.replySubmitting') : t('actions.replySubmit')}
      </button>
    </form>
  );
}
