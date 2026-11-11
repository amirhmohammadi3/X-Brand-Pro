'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Rating, Badge } from '@/components/ui';
import { createFormatters } from '@/lib/format';
import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { ReviewVoteButtons, ReviewReportButton, ReviewReplyForm } from './business-review-actions';
import { reviewListResultSchema, type Review, type PageMeta } from '@app/contracts';

/**
 * Business reviews section (F4.4) — summary + filters + paginated list.
 *
 * The B4.9 aggregate already carries the first reviews page + meta.total +
 * business.avgRating, so the page SERVER-RENDERS this component with that
 * initial data (SEO: reviews are in the first-paint HTML). The component
 * hydrates and owns the interactive layer:
 *  - filters: sort (newest / most helpful / highest / lowest rating) +
 *    verified-only + with-photo, applied CLIENT-SIDE to the loaded set;
 *  - load-more: fetches the next page (`GET /businesses/:id/reviews`) and
 *    appends, so filters re-apply over the growing set.
 *
 * The backend list supports pagination only (no sort/filter query params —
 * B4.1), so filtering the loaded set is the honest scope; a backend
 * sort/filter is a Follow-up. The rating distribution is computed from the
 * loaded reviews (it sharpens as the user loads more); the avg/count in the
 * summary header are the accurate aggregate figures.
 */
type SortKey = 'newest' | 'helpful' | 'highRating' | 'lowRating';

export interface BusinessReviewsProps {
  businessId: string;
  /** The business's owner user id — when the current user matches, each review
   * shows the editable owner-reply form instead of the static reply display. */
  ownerId?: string | null;
  avgRating: number;
  reviewCount: number;
  initialReviews: Review[];
  initialMeta: PageMeta;
}

export function BusinessReviews({
  businessId,
  ownerId,
  avgRating,
  reviewCount,
  initialReviews,
  initialMeta,
}: BusinessReviewsProps) {
  const t = useTranslations('businessPage.reviews');
  const locale = useLocale();
  const { formatNumber } = createFormatters(locale);
  const [loaded, setLoaded] = useState<Review[]>(initialReviews);
  const [page, setPage] = useState(initialMeta.page);
  const [totalPages, setTotalPages] = useState(initialMeta.totalPages);
  const [sort, setSort] = useState<SortKey>('newest');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [withPhoto, setWithPhoto] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasMore = page < totalPages;

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const { data } = await apiFetch(`/businesses/${businessId}/reviews`, reviewListResultSchema, {
        query: { page: next, pageSize: 20 },
      });
      setLoaded((prev) => [...prev, ...data.items]);
      setPage(data.meta.page);
      setTotalPages(data.meta.totalPages);
    } catch {
      // network/API error — leave the loaded set as-is; the button stays
      // available for a retry on the next click.
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = useMemo(() => {
    let r = loaded;
    if (verifiedOnly) r = r.filter((x) => x.verified);
    if (withPhoto) r = r.filter((x) => x.photoUrl !== null);
    const sorted = [...r];
    switch (sort) {
      case 'helpful':
        sorted.sort((a, b) => b.helpfulCount - a.helpfulCount);
        break;
      case 'highRating':
        sorted.sort((a, b) => b.rating - a.rating);
        break;
      case 'lowRating':
        sorted.sort((a, b) => a.rating - b.rating);
        break;
      case 'newest':
      default:
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
    }
    return sorted;
  }, [loaded, verifiedOnly, withPhoto, sort]);

  // distribution from the loaded set (5★ → 1★).
  const dist = useMemo(() => {
    const counts = [0, 0, 0, 0, 0]; // index 0 = 1★ … 4 = 5★
    for (const r of loaded) counts[r.rating - 1] = (counts[r.rating - 1] ?? 0) + 1;
    return counts;
  }, [loaded]);

  if (reviewCount === 0) {
    return (
      <p className="text-sm text-muted" data-testid="business-reviews-empty">
        {t('noReviews')}
      </p>
    );
  }

  const filtersActive = verifiedOnly || withPhoto || sort !== 'newest';

  return (
    <div className="flex flex-col gap-4" data-testid="business-reviews">
      {/* ── summary: avg + distribution ─────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-6 rounded-lg border border-border-subtle bg-surface-alt p-4"
        data-testid="business-reviews-summary"
      >
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl font-semibold tabular-nums text-text">
            {formatNumber(avgRating, { maximumFractionDigits: 1 })}
          </span>
          <Rating value={avgRating} readOnly />
          <span className="text-xs text-muted">
            {t('basedOn', { count: formatNumber(reviewCount) })}
          </span>
        </div>
        <div
          className="flex flex-1 flex-col gap-1"
          data-testid="business-reviews-distribution"
          aria-label={t('avgRating')}
        >
          {[5, 4, 3, 2, 1].map((star) => {
            const c = dist[star - 1] ?? 0;
            const pct = loaded.length > 0 ? Math.round((c / loaded.length) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-2 text-xs">
                <span className="w-4 tabular-nums text-muted">{formatNumber(star)}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-surface">
                  <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 tabular-nums text-muted">{formatNumber(c)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3" data-testid="business-reviews-filters">
        <label className="flex items-center gap-1.5 text-sm text-text">
          <span>{t('filters.sort')}</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-border-subtle bg-surface px-2 py-1 text-sm"
            data-testid="business-reviews-sort"
          >
            <option value="newest">{t('filters.newest')}</option>
            <option value="helpful">{t('filters.helpful')}</option>
            <option value="highRating">{t('filters.highRating')}</option>
            <option value="lowRating">{t('filters.lowRating')}</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text">
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
            data-testid="business-reviews-verified"
          />
          <span>{t('filters.verifiedOnly')}</span>
        </label>
        <label className="flex items-center gap-1.5 text-sm text-text">
          <input
            type="checkbox"
            checked={withPhoto}
            onChange={(e) => setWithPhoto(e.target.checked)}
            data-testid="business-reviews-photo"
          />
          <span>{t('filters.withPhoto')}</span>
        </label>
        {filtersActive ? (
          <button
            type="button"
            onClick={() => {
              setSort('newest');
              setVerifiedOnly(false);
              setWithPhoto(false);
            }}
            className="text-xs text-primary underline underline-offset-2"
            data-testid="business-reviews-clear"
          >
            {t('filters.clear')}
          </button>
        ) : null}
      </div>

      {/* ── list ────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted" data-testid="business-reviews-no-matches">
          {t('noMatches')}
        </p>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="business-reviews-list">
          {filtered.map((r) => (
            <ReviewItem key={r.id} review={r} locale={locale} ownerId={ownerId} />
          ))}
        </ul>
      )}

      {/* ── load more ───────────────────────────────────────────────────── */}
      {hasMore ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-lg border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-text transition-colors hover:border-primary disabled:opacity-60"
            data-testid="business-reviews-loadmore"
          >
            {t('loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One review card. Calls its own `useTranslations` (avoids threading the
 * typed translation fn as a prop). */
function ReviewItem({
  review,
  locale,
  ownerId,
}: {
  review: Review;
  locale: string;
  ownerId?: string | null;
}) {
  const t = useTranslations('businessPage.reviews');
  const { formatNumber, formatRelative } = createFormatters(locale);
  const { user } = useAuth();
  const isOwner = ownerId != null && user?.id === ownerId;
  const author = review.authorName ?? review.authorUsername;
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      data-testid="business-review-item"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/user/${review.authorUsername}`}
            className="text-sm font-semibold text-text hover:text-primary"
          >
            {author}
          </Link>
          {review.verified ? (
            <Badge variant="success" data-testid="business-review-verified">
              {t('item.verified')}
            </Badge>
          ) : null}
          {review.isFirstReview ? (
            <Badge variant="primary" data-testid="business-review-first">
              {t('item.firstReview')}
            </Badge>
          ) : null}
        </div>
        <Rating value={review.rating} readOnly size="sm" />
      </div>

      {review.body ? <p className="text-sm leading-relaxed text-text">{review.body}</p> : null}

      {review.photoUrl ? (
        <img
          src={review.photoUrl}
          alt=""
          loading="lazy"
          className="max-h-60 w-auto rounded-lg border border-border-subtle object-cover"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{formatRelative(review.createdAt)}</span>
        {review.helpfulCount > 0 ? (
          <span>{t('item.helpfulCount', { count: formatNumber(review.helpfulCount) })}</span>
        ) : null}
        {review.editedAt ? <span>{t('item.edited')}</span> : null}
      </div>

      {/* vote + report (F4.6) */}
      <div className="flex flex-wrap items-center gap-3">
        <ReviewVoteButtons review={review} />
        <ReviewReportButton reviewId={review.id} />
      </div>

      {/* owner reply: editable form for the owner, static display for others */}
      {isOwner ? (
        <ReviewReplyForm reviewId={review.id} existingReply={review.reply} />
      ) : review.reply ? (
        <div
          className="mt-1 rounded-lg border-s-2 border-primary bg-surface-alt p-3 text-sm"
          data-testid="business-review-reply"
        >
          <p className="text-xs font-semibold text-primary">{t('item.ownerReply')}</p>
          <p className="mt-1 text-text">{review.reply.body}</p>
        </div>
      ) : null}
    </li>
  );
}
