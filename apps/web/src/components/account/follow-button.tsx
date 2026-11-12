'use client';

/**
 * FollowButton (F5.2) — the follow/unfollow toggle for a user OR a business.
 *
 * Membership state derives from the cached `GET /follows/me` lists (B5.2 has
 * no per-target status probe): one shared request serves every mounted button
 * plus the account page, and a toggle invalidates the whole `qk.follows`
 * subtree so every other button flips with it.
 *
 * Rules mirrored from the B5.2 service contract:
 *  - every follows endpoint is authenticated — an anonymous visitor gets a
 *    login link instead of a button (the BusinessClaimButton gate pattern);
 *  - a write in flight blocks further clicks so a double-click never fires
 *    two writes against the 30/min budget;
 *  - the membership probe is pending on first mount → the button renders
 *    disabled until the lists resolve, so a slow read never paints an
 *    off-state that flips on a frame later.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Check, UserPlus } from 'lucide-react';
import { isApiRequestError } from '../../lib/api/errors';
import {
  useFollowBusiness,
  useFollowUser,
  useMyFollows,
  useUnfollowBusiness,
  useUnfollowUser,
} from '../../lib/api/follows';
import { useAuth } from '../../lib/auth/auth-context';
import { Button, useToast } from '../ui';
import { cn } from '../../lib/cn';

export interface FollowButtonProps {
  /** Which follow list decides membership and which endpoint the toggle hits. */
  targetType: 'user' | 'business';
  targetId: string;
  /** The target's display name — surfaced in aria-labels and the toasts. */
  targetName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function FollowButton({
  targetType,
  targetId,
  targetName,
  size = 'md',
  className,
}: FollowButtonProps) {
  const t = useTranslations('account.following.followButton');
  const tRoot = useTranslations();
  const toast = useToast();
  const { status } = useAuth();

  const { result: follows, isPending: minePending } = useMyFollows(status === 'authenticated');
  const followBusiness = useFollowBusiness();
  const unfollowBusiness = useUnfollowBusiness();
  const followUser = useFollowUser();
  const unfollowUser = useUnfollowUser();

  const following = useMemo(() => {
    if (!follows) return false;
    return targetType === 'business'
      ? follows.businesses.some((row) => row.business.id === targetId)
      : follows.users.some((row) => row.id === targetId);
  }, [follows, targetType, targetId]);

  const writePending =
    followBusiness.isPending ||
    unfollowBusiness.isPending ||
    followUser.isPending ||
    unfollowUser.isPending;

  // Anonymous visitors see a compact login link (no API call is ever fired).
  if (status !== 'authenticated') {
    return (
      <Button
        asChild
        variant="secondary"
        size={size}
        className={className}
        data-testid="follow-login-gate"
      >
        <Link href="/login">
          <UserPlus size={16} aria-hidden />
          {t('loginPrompt')}
        </Link>
      </Button>
    );
  }

  const handleClick = async (): Promise<void> => {
    if (writePending) return;
    const follow = targetType === 'business' ? followBusiness : followUser;
    const unfollow = targetType === 'business' ? unfollowBusiness : unfollowUser;
    try {
      if (following) {
        await unfollow.mutateAsync(targetId);
        toast.success(t('toastUnfollowed', { name: targetName }));
      } else {
        await follow.mutateAsync(targetId);
        toast.success(t('toastFollowed', { name: targetName }));
      }
    } catch (err) {
      toast.error(mapFollowError(err, tRoot, t));
    }
  };

  const label = following
    ? t('unfollowAria', { name: targetName })
    : t('followAria', { name: targetName });

  return (
    <Button
      type="button"
      variant={following ? 'secondary' : 'primary'}
      size={size}
      loading={writePending || (minePending && !follows)}
      disabled={minePending && !follows}
      onClick={handleClick}
      aria-pressed={following}
      aria-label={label}
      title={label}
      data-testid="follow-button"
      data-following={following ? 'true' : 'false'}
      className={cn(className)}
    >
      {following ? (
        <Check size={16} aria-hidden className="text-success" />
      ) : (
        <UserPlus size={16} aria-hidden />
      )}
      {following ? t('following') : t('follow')}
    </Button>
  );
}

/** Map an ApiRequestError to a friendly i18n message; fall back to a generic error. */
function mapFollowError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!isApiRequestError(err)) return t('serverError');
  // 422 covers the self-follow gate (users); the API carries an i18n messageKey.
  if (err.status === 422) return t('selfFollow');
  if (err.isRateLimited) return tRoot('auth.rateLimited');
  return tRoot(err.messageKey) ?? t('serverError');
}
