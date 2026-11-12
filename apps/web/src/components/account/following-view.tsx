'use client';

/**
 * FollowingView (F5.2) — the `/account/following` body.
 *
 * One `GET /follows/me` serves both sections (B5.2 returns the two lists
 * joined, newest follow first):
 *  - followed businesses as cards (the B2.4 summary + unfollow);
 *  - followed users as rows (avatar, display name, @username, follow stamp).
 *
 * Unfollow is the same idempotent DELETE the service exposes — the row leaves
 * the list via the hooks' `qk.follows` invalidation refetch, so the UI never
 * maintains a parallel copy of the follow state.
 */
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Store, UserRound, UserRoundX } from 'lucide-react';
import type { FollowedBusiness, FollowedUser } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { pickLocalized } from '../../lib/localized';
import { isApiRequestError } from '../../lib/api/errors';
import { useMyFollows, useUnfollowBusiness, useUnfollowUser } from '../../lib/api/follows';
import { Avatar, Badge, Button, EmptyState, ErrorState, Rating, Spinner, useToast } from '../ui';

export function FollowingView() {
  const t = useTranslations('account.following');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const { result: follows, isPending, error } = useMyFollows();

  const unfollowBusiness = useUnfollowBusiness();
  const unfollowUser = useUnfollowUser();

  if (isPending && !follows) {
    return <Spinner aria-label={tRoot('common.loading')} />;
  }
  if (error) {
    return <ErrorState error={t('loadError')} />;
  }

  const businesses = follows?.businesses ?? [];
  const users = follows?.users ?? [];

  const handleUnfollowBusiness = async (row: FollowedBusiness): Promise<void> => {
    try {
      await unfollowBusiness.mutateAsync(row.business.id);
      toast.success(t('unfollowedToast', { name: row.business.name }));
    } catch (err) {
      toast.error(mapFollowError(err, tRoot, t));
    }
  };

  const handleUnfollowUser = async (row: FollowedUser): Promise<void> => {
    try {
      await unfollowUser.mutateAsync(row.id);
      toast.success(t('unfollowedToast', { name: row.displayName ?? row.username }));
    } catch (err) {
      toast.error(mapFollowError(err, tRoot, t));
    }
  };

  const empty = businesses.length === 0 && users.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      {empty ? (
        <EmptyState
          icon={UserRound}
          title={t('emptyTitle')}
          description={t('emptyBody')}
          action={{
            label: tRoot('nav.search'),
            onClick: () => {
              if (typeof window !== 'undefined') {
                window.location.href = `/${locale}/search`;
              }
            },
          }}
        />
      ) : (
        <>
          {/* ── followed businesses ─────────────────────────────────────── */}
          <section
            aria-labelledby="following-businesses"
            className="rounded-md border border-border bg-surface p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="following-businesses" className="text-base font-semibold text-text">
                {t('businessesTitle')}
              </h2>
              <Badge variant="neutral">{businesses.length}</Badge>
            </div>
            {businesses.length === 0 ? (
              <p className="py-2 text-sm text-text-subtle">{t('noBusinesses')}</p>
            ) : (
              <ul
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
                data-testid="following-businesses-list"
              >
                {businesses.map((row) => (
                  <FollowedBusinessCard
                    key={row.business.id}
                    row={row}
                    locale={locale}
                    onUnfollow={() => handleUnfollowBusiness(row)}
                    unfollowPending={unfollowBusiness.isPending}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* ── followed users ──────────────────────────────────────────── */}
          <section
            aria-labelledby="following-users"
            className="rounded-md border border-border bg-surface p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="following-users" className="text-base font-semibold text-text">
                {t('usersTitle')}
              </h2>
              <Badge variant="neutral">{users.length}</Badge>
            </div>
            {users.length === 0 ? (
              <p className="py-2 text-sm text-text-subtle">{t('noUsers')}</p>
            ) : (
              <ul
                className="flex flex-col divide-y divide-border-subtle"
                data-testid="following-users-list"
              >
                {users.map((row) => (
                  <FollowedUserRow
                    key={row.id}
                    row={row}
                    locale={locale}
                    onUnfollow={() => handleUnfollowUser(row)}
                    unfollowPending={unfollowUser.isPending}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FollowedBusinessCard — one card in the businesses section.
// ---------------------------------------------------------------------------

function FollowedBusinessCard({
  row,
  locale,
  onUnfollow,
  unfollowPending,
}: {
  row: FollowedBusiness;
  locale: string;
  onUnfollow: () => void;
  unfollowPending: boolean;
}) {
  const t = useTranslations('account.following');
  const { formatDate, formatNumber } = createFormatters(locale);
  const categoryName = pickLocalized(row.business.primaryCategory.name, locale);
  const cityName = pickLocalized(row.business.city.name, locale);

  return (
    <li
      data-testid="followed-business-card"
      className="flex flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface"
    >
      <Link href={`/business/${row.business.slug}`} className="block">
        <div className="flex aspect-[16/9] items-center justify-center bg-surface-alt">
          {row.business.thumbUrl !== null ? (
            <img
              src={row.business.thumbUrl}
              alt={row.business.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <Store aria-hidden className="text-3xl text-muted" />
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <h3 className="line-clamp-1 text-sm font-semibold text-text">{row.business.name}</h3>
          <p className="line-clamp-1 text-xs text-muted">
            {[categoryName, cityName].filter((s) => s !== '').join(' · ')}
          </p>
          <div className="flex items-center gap-2">
            <Rating value={row.business.avgRating} size="sm" readOnly />
            <span className="text-xs tabular-nums text-muted">
              {formatNumber(row.business.reviewCount)}
            </span>
          </div>
        </div>
      </Link>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-subtle p-2">
        <span className="text-xs text-muted">
          {t('followedSince', { date: formatDate(row.followedAt, 'medium') })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={unfollowPending}
          onClick={onUnfollow}
          aria-label={t('unfollowAction', { name: row.business.name })}
          className="text-danger"
          data-testid={`unfollow-business-${row.business.id}`}
        >
          <UserRoundX size={14} aria-hidden />
          {t('unfollow')}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// FollowedUserRow — one row in the users section.
// ---------------------------------------------------------------------------

function FollowedUserRow({
  row,
  locale,
  onUnfollow,
  unfollowPending,
}: {
  row: FollowedUser;
  locale: string;
  onUnfollow: () => void;
  unfollowPending: boolean;
}) {
  const t = useTranslations('account.following');
  const { formatDate } = createFormatters(locale);
  const name = row.displayName ?? row.username;

  return (
    <li
      className="flex flex-wrap items-center gap-3 py-3"
      data-testid="followed-user-row"
      data-user-id={row.id}
    >
      <Avatar src={row.avatarUrl ?? undefined} name={name} size="md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/user/${row.username}`}
          className="line-clamp-1 text-sm font-medium text-text hover:text-primary"
        >
          {name}
        </Link>
        <span className="text-xs text-muted">@{row.username}</span>
      </div>
      <span className="text-xs text-muted">
        {t('followedSince', { date: formatDate(row.followedAt, 'medium') })}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={unfollowPending}
        onClick={onUnfollow}
        aria-label={t('unfollowAction', { name })}
        className="text-danger"
        data-testid={`unfollow-user-${row.id}`}
      >
        <UserRoundX size={14} aria-hidden />
        {t('unfollow')}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapFollowError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!isApiRequestError(err)) return t('serverError');
  if (err.isRateLimited) return tRoot('auth.rateLimited');
  return tRoot(err.messageKey) ?? t('serverError');
}
