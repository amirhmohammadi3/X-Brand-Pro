'use client';

/**
 * FeedView (F5.2) — the `/account/feed` body.
 *
 * The home feed is the PULL-BASED `GET /feed` from B5.2: one append-only
 * `activity_events` row per public action (review created, question
 * created/answered, favorite added) written by the domain-event subscriber.
 * Reads join the actors the caller follows, so an EMPTY feed usually means
 * «follow someone» — the empty state says exactly that and links to search.
 *
 * The four activity types render as a tab filter (all / one type each); the
 * active tab + page form the query key so every tab keeps its own page cache.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Heart, MessageSquare, MessageSquareReply, Star, UserRound } from 'lucide-react';
import { type ActivityType, type FeedItem } from '@app/contracts';
import { createFormatters } from '../../lib/format';
import { useFeed, FEED_PAGE_SIZE } from '../../lib/api/follows';
import { Avatar, Badge, EmptyState, ErrorState, Pagination, Spinner, Tabs } from '../ui';

/** Tab value for the unfiltered feed. */
const TAB_ALL = 'all';

export function FeedView() {
  const t = useTranslations('account.feed');
  const tRoot = useTranslations();
  const locale = useLocale();
  const { formatRelative } = createFormatters(locale);

  const [tab, setTab] = useState<string>(TAB_ALL);
  const [page, setPage] = useState(1);

  // 'all' → no `type` query param; otherwise the tab value IS the ActivityType.
  const type: ActivityType | null = tab === TAB_ALL ? null : (tab as ActivityType);
  const { result, isPending, error } = useFeed(type, page, FEED_PAGE_SIZE);

  const handleTabChange = (value: string): void => {
    setTab(value);
    setPage(1); // A new tab starts a fresh pagination walk.
  };

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <ErrorState error={t('loadError')} />
      </div>
    );
  }

  const items = result?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="w-full"
        tabs={[
          { value: TAB_ALL, label: t('tabAll') },
          { value: 'review.created', label: t('tabReviews') },
          { value: 'question.created', label: t('tabQuestions') },
          { value: 'question.answered', label: t('tabAnswers') },
          { value: 'favorite.added', label: t('tabFavorites') },
        ]}
      />

      {isPending && !result ? (
        <Spinner aria-label={tRoot('common.loading')} />
      ) : items.length === 0 ? (
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
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-border-subtle" data-testid="feed-list">
            {items.map((item) => (
              <FeedRow key={item.id} item={item} formatRelative={formatRelative} />
            ))}
          </ul>
          {result && result.meta.totalPages > 1 ? (
            <Pagination page={page} totalPages={result.meta.totalPages} onPageChange={setPage} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeedRow — one activity item.
// ---------------------------------------------------------------------------

const TYPE_ICON: Record<ActivityType, typeof Star> = {
  'review.created': Star,
  'question.created': MessageSquare,
  'question.answered': MessageSquareReply,
  'favorite.added': Heart,
};

function FeedRow({
  item,
  formatRelative,
}: {
  item: FeedItem;
  formatRelative: (date: Date | number | string) => string;
}) {
  const t = useTranslations('account.feed');
  const actorName = item.actor.displayName ?? item.actor.username;
  const Icon = TYPE_ICON[item.type];
  const line =
    item.business !== null
      ? t(itemLineKey(item.type), {
          actor: actorName,
          business: item.business.name,
        })
      : t('itemFallback', { actor: actorName });

  return (
    <li className="flex items-start gap-3 py-3" data-testid="feed-item" data-feed-type={item.type}>
      <span
        aria-hidden
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-alt text-muted"
      >
        <Icon size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar
            src={item.actor.avatarUrl ?? undefined}
            name={actorName}
            size="sm"
            className="shrink-0"
          />
          <span dir="auto" className="text-sm leading-relaxed text-text">
            {line}
          </span>
          <Badge variant="neutral" className="shrink-0">
            {t(badgeKeyFor(item.type))}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>{formatRelative(item.createdAt)}</span>
          {item.business !== null ? (
            <Link
              href={`/business/${item.business.slug}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {item.business.name}
            </Link>
          ) : null}
          <Link
            href={`/user/${item.actor.username}`}
            className="text-muted underline-offset-2 hover:underline"
          >
            @{item.actor.username}
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Map an activity type to its flat i18n line key (itemReviewCreated, …). */
function itemLineKey(
  type: ActivityType,
): 'itemReviewCreated' | 'itemQuestionCreated' | 'itemQuestionAnswered' | 'itemFavoriteAdded' {
  switch (type) {
    case 'review.created':
      return 'itemReviewCreated';
    case 'question.created':
      return 'itemQuestionCreated';
    case 'question.answered':
      return 'itemQuestionAnswered';
    case 'favorite.added':
      return 'itemFavoriteAdded';
  }
}

/** Map an activity type to its flat badge i18n key (tabReviews, …). */
function badgeKeyFor(
  type: ActivityType,
): 'tabReviews' | 'tabQuestions' | 'tabAnswers' | 'tabFavorites' {
  switch (type) {
    case 'review.created':
      return 'tabReviews';
    case 'question.created':
      return 'tabQuestions';
    case 'question.answered':
      return 'tabAnswers';
    case 'favorite.added':
      return 'tabFavorites';
  }
}
