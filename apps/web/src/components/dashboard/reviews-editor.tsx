'use client';

/**
 * ReviewsEditor (F7.4) — the `/dashboard/:businessId/reviews` body.
 *
 * The owner's reviews console: a paginated list of the business's APPROVED
 * reviews (newest first) with the per-review owner reply (create / edit /
 * delete). The list is the public read `GET /businesses/:id/reviews` — the
 * owner sees exactly what customers see, plus reply controls. Pending and
 * rejected reviews are a moderation view (`reviews.manage`) and live in the
 * admin panel, not here.
 *
 * Reply lifecycle (B4.3): one reply per review, upserted by `PUT
 * /reviews/:id/reply` (`created` distinguishes the first write from an edit)
 * and removed by `DELETE /reviews/:id/reply` (idempotent). The API enforces
 * ownership; a 403 here means the caller no longer owns the business. The
 * reply body is validated client-side against the contract bounds (2..1000
 * chars) so the textarea's `min/maxLength` and the disabled submit mirror the
 * server exactly.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { REPLY_BODY_MAX, REPLY_BODY_MIN, type Review } from '@app/contracts';
import { useLocale } from 'next-intl';
import { MessageSquareOff } from 'lucide-react';
import {
  useRemoveReviewReply,
  useUpsertReviewReply,
  useBusinessReviews,
} from '../../lib/api/dashboard-reviews';
import { isApiRequestError } from '../../lib/api/errors';
import { createFormatters } from '../../lib/format';
import { useToast } from '../ui/toast';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Heading,
  IconButton,
  Pagination,
  Rating,
  Spinner,
} from '../ui';
import { SubmitButton } from '../ui/form';

const PAGE_SIZE = 10;

export function ReviewsEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const fmt = createFormatters(locale);
  const toast = useToast();
  const [page, setPage] = useState(1);

  const { result, isPending, error } = useBusinessReviews(businessId, page, PAGE_SIZE);
  const upsertMutation = useUpsertReviewReply(businessId);
  const removeMutation = useRemoveReviewReply(businessId);

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={t('reviews.loading')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => setPage((p) => p)} />;
  }

  const items = result?.items ?? [];
  const meta = result?.meta;

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-reviews">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h2" className="text-lg">
          {t('reviews.title')}
        </Heading>
        {meta ? (
          <span className="text-sm text-text-subtle">
            {t('reviews.count', { total: meta.total })}
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquareOff}
          title={t('reviews.emptyTitle')}
          description={t('reviews.emptyMessage')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((review) => (
            <ReviewRow
              key={review.id}
              review={review}
              fmt={fmt}
              onUpsert={async (body) => {
                try {
                  const res = await upsertMutation.mutateAsync({ reviewId: review.id, body });
                  toast.success(
                    res.created ? t('reviews.replyCreated') : t('reviews.replyUpdated'),
                  );
                } catch (e) {
                  toast.error(
                    isApiRequestError(e) && e.isClientError ? e.message : t('reviews.replyError'),
                  );
                }
              }}
              onRemove={async () => {
                try {
                  await removeMutation.mutateAsync(review.id);
                  toast.success(t('reviews.replyRemoved'));
                } catch (e) {
                  toast.error(
                    isApiRequestError(e) && e.isClientError ? e.message : t('reviews.replyError'),
                  );
                }
              }}
              upserting={upsertMutation.isPending}
              removing={removeMutation.isPending}
            />
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  );
}

interface ReviewRowProps {
  review: Review;
  fmt: ReturnType<typeof createFormatters>;
  onUpsert: (body: { body: string }) => Promise<void>;
  onRemove: () => Promise<void>;
  upserting: boolean;
  removing: boolean;
}

function ReviewRow({ review, fmt, onUpsert, onRemove, upserting, removing }: ReviewRowProps) {
  const t = useTranslations('dashboard');
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(review.reply?.body ?? '');

  function startEdit() {
    setBody(review.reply?.body ?? '');
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length < REPLY_BODY_MIN || upserting) return;
    await onUpsert({ body: trimmed });
    setOpen(false);
  }

  const authorLabel = review.authorName ?? review.authorUsername;
  const reply = review.reply;

  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Rating value={review.rating} readOnly />
              <span className="text-sm font-medium text-text">{authorLabel}</span>
              {review.verified ? <Badge variant="success">{t('reviews.verified')}</Badge> : null}
              {review.isFirstReview ? (
                <Badge variant="primary">{t('reviews.firstReview')}</Badge>
              ) : null}
            </div>
            <time className="text-xs text-muted" dateTime={review.createdAt}>
              {fmt.formatDateTime(new Date(review.createdAt), 'medium')}
            </time>
          </div>

          <p className="whitespace-pre-wrap text-sm text-text">{review.body}</p>

          {review.photoUrl ? (
            <img
              src={review.photoUrl}
              alt={t('reviews.photoAlt')}
              className="h-32 w-auto rounded border border-border-subtle"
            />
          ) : null}

          {reply ? (
            <div
              className="rounded-lg border-s-2 border-primary bg-surface-alt p-3 text-sm"
              data-testid="dashboard-review-reply"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">
                  {t('reviews.replyLabel')}
                </span>
                <time className="text-xs text-muted" dateTime={reply.createdAt}>
                  {fmt.formatDateTime(new Date(reply.createdAt), 'medium')}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-text">{reply.body}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-xs text-primary underline underline-offset-4"
                  data-testid="dashboard-review-reply-edit"
                >
                  {t('reviews.replyEdit')}
                </button>
                <IconButton
                  icon={Trash2}
                  aria-label={t('reviews.replyDelete')}
                  onClick={() => void onRemove()}
                  disabled={removing}
                />
              </div>
            </div>
          ) : null}

          {!reply && !open ? (
            <button
              type="button"
              onClick={startEdit}
              className="self-start text-sm text-primary underline underline-offset-4"
              data-testid="dashboard-review-reply-add"
            >
              {t('reviews.replyAdd')}
            </button>
          ) : null}

          {open ? (
            <form
              onSubmit={submit}
              className="flex flex-col gap-2"
              data-testid="dashboard-review-reply-form"
            >
              <label className="flex flex-col gap-1 text-sm text-text">
                <span>{t('reviews.replyLabel')}</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('reviews.replyPlaceholder')}
                  rows={3}
                  minLength={REPLY_BODY_MIN}
                  maxLength={REPLY_BODY_MAX}
                  className="rounded border border-border-subtle bg-surface px-2 py-1"
                  data-testid="dashboard-review-reply-input"
                />
              </label>
              <span className="text-xs text-muted">
                {t('reviews.replyCharCount', {
                  count: body.length,
                  min: REPLY_BODY_MIN,
                  max: REPLY_BODY_MAX,
                })}
              </span>
              <div className="flex items-center gap-2">
                <SubmitButton loading={upserting} disabled={body.trim().length < REPLY_BODY_MIN}>
                  {reply ? t('reviews.replySave') : t('reviews.replySubmit')}
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-text-subtle underline underline-offset-4"
                >
                  {t('reviews.replyCancel')}
                </button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </li>
  );
}
