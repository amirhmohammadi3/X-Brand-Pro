import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { apiFetchServer } from '@/lib/api/server';
import { createFormatters } from '@/lib/format';
import { Rating, Badge, Separator } from '@/components/ui';
import {
  publicProfileSchema,
  publicProfileReviewsResultSchema,
  type PublicProfile,
  type Review,
} from '@app/contracts';

/**
 * Public user profile page (F4.8) — `/[locale]/user/[username]`. Renders the
 * B4.10 public profile (identity + trust signals + join date) and the user's
 * first page of APPROVED reviews (`GET /users/:username/reviews`). The
 * profile is privacy-minimal by contract (no email/phone/points/ban state);
 * a blocked user 404s — existence is never leaked.
 *
 * Server component: two `@Public` reads via `apiFetchServer`, schema-validated,
 * degrading to a not-found block on any failure. The reviews are a flat
 * display here (the business page owns vote/report/reply); load-more
 * pagination is a Follow-up.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  try {
    const { data } = await apiFetchServer(`/users/${username}`, publicProfileSchema);
    return { title: data.displayName ?? data.username };
  } catch {
    return { title: username };
  }
}

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const locale = await getLocale();
  const t = await getTranslations('userPage');
  const tA11y = await getTranslations('a11y');
  const { formatDate, formatNumber, formatRelative } = createFormatters(locale);

  let profile: PublicProfile | null = null;
  let reviews: Review[] = [];
  try {
    const [profRes, revRes] = await Promise.all([
      apiFetchServer(`/users/${username}`, publicProfileSchema),
      apiFetchServer(`/users/${username}/reviews`, publicProfileReviewsResultSchema),
    ]);
    profile = profRes.data;
    reviews = revRes.data.items;
  } catch {
    // 404 / inactive / network — fall through to the not-found block.
  }

  if (!profile) {
    return (
      <main
        id="main"
        aria-label={tA11y('mainContent')}
        className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-4 py-16 text-center"
      >
        <h1 className="text-2xl font-semibold text-text">{t('notFound.title')}</h1>
        <p className="text-sm text-muted">{t('notFound.body')}</p>
        <Link href="/" className="text-sm text-primary underline underline-offset-4">
          {t('notFound.backHome')}
        </Link>
      </main>
    );
  }

  const displayName = profile.displayName ?? profile.username;
  const levelLabel = t(`levelNames.${profile.level}` as 'newcomer');

  return (
    <main
      id="main"
      aria-label={tA11y('mainContent')}
      className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6"
    >
      {/* ── profile header ─────────────────────────────────────────────── */}
      <section
        className="flex flex-col items-center gap-3 text-center"
        data-testid="user-profile-header"
      >
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-surface-alt">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden className="text-2xl font-semibold text-muted">
              {displayName.charAt(0)}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-text">{displayName}</h1>
        <p className="text-sm text-muted">@{profile.username}</p>
        <Badge variant="primary" data-testid="user-level-badge">
          {t('level')}: {levelLabel}
        </Badge>
        <p className="text-xs text-muted">
          {t('joinedAt', { date: formatDate(profile.joinedAt, 'medium') })}
        </p>
      </section>

      {/* ── trust stats ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-3" data-testid="user-profile-stats">
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border-subtle bg-surface p-3">
          <span className="text-lg font-semibold tabular-nums text-text">
            {formatNumber(profile.stats.approvedReviews)}
          </span>
          <span className="text-center text-xs text-muted">{t('stats.approvedReviews')}</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border-subtle bg-surface p-3">
          <span className="text-lg font-semibold tabular-nums text-text">
            {formatNumber(profile.stats.verifiedReviews)}
          </span>
          <span className="text-center text-xs text-muted">{t('stats.verifiedReviews')}</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-lg border border-border-subtle bg-surface p-3">
          <span className="text-lg font-semibold tabular-nums text-text">
            {formatNumber(profile.stats.helpfulVotesReceived)}
          </span>
          <span className="text-center text-xs text-muted">{t('stats.helpfulVotesReceived')}</span>
        </div>
      </section>

      <Separator />

      {/* ── reviews ────────────────────────────────────────────────────── */}
      <section aria-labelledby="user-reviews" className="flex flex-col gap-4">
        <h2 id="user-reviews" className="text-xl font-semibold text-text">
          {t('reviewsTitle')} ({formatNumber(reviews.length)})
        </h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted" data-testid="user-profile-no-reviews">
            {t('noReviews')}
          </p>
        ) : (
          <ul className="flex flex-col gap-4" data-testid="user-profile-reviews">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
                data-testid="user-profile-review-item"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Rating value={r.rating} readOnly size="sm" />
                  <div className="flex items-center gap-2 text-xs text-muted">
                    {r.verified ? (
                      <Badge variant="success">{t('stats.verifiedReviews')}</Badge>
                    ) : null}
                    <span>{formatRelative(r.createdAt)}</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-text">{r.body}</p>
                {r.photoUrl ? (
                  <img
                    src={r.photoUrl}
                    alt=""
                    loading="lazy"
                    className="max-h-60 w-auto rounded-lg border border-border-subtle object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
