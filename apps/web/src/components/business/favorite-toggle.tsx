'use client';

/**
 * FavoriteToggle (F5.1) — the heart button on a business card / page.
 *
 * One probe (`GET /favorites/me/check?businessId=`) drives the filled state;
 * the click is a heart-on (`POST /favorites/items`, default list, lazy-created
 * server-side) or a heart-off (`DELETE /favorites/items/:id`). The toggle is
 * optimistic on success (the probe cache is seeded before the refetch) and
 * disabled while a write is in flight so a double-click never fires two
 * writes against the 30/min budget.
 *
 * The toggle is a controlled-by-id component: pass the `businessId` and it
 * owns its own data. It renders nothing while the probe is pending the very
 * first time (so a slow check never paints an empty heart that flips filled
 * a frame later — the layout shift is avoided by the caller reserving space).
 */
import { Heart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isApiRequestError } from '../../lib/api/errors';
import {
  useAddFavoriteToDefault,
  useFavoriteStatus,
  useRemoveFavoriteItem,
} from '../../lib/api/favorites';
import { useToast } from '../ui/toast';
import { cn } from '../../lib/cn';

export interface FavoriteToggleProps {
  businessId: string;
  /** The business name — surfaced in the aria-label and the toast. */
  businessName: string;
  /** Visual size of the heart button (matches IconButton sizes). */
  size?: 'sm' | 'md' | 'lg';
  /** Extra classes (e.g. absolute positioning over a card thumb). */
  className?: string;
}

const SIZE_PX: Record<NonNullable<FavoriteToggleProps['size']>, { box: string; icon: number }> = {
  sm: { box: 'h-8 w-8', icon: 16 },
  md: { box: 'h-10 w-10', icon: 20 },
  lg: { box: 'h-12 w-12', icon: 24 },
};

export function FavoriteToggle({
  businessId,
  businessName,
  size = 'md',
  className,
}: FavoriteToggleProps) {
  const t = useTranslations('account.favorites');
  const tRoot = useTranslations();
  const toast = useToast();
  const { status, isPending } = useFavoriteStatus(businessId);
  const addFav = useAddFavoriteToDefault();
  const removeFav = useRemoveFavoriteItem();

  const favorited = status?.favorited ?? false;
  const itemId = status?.itemId ?? null;
  // A write is in flight: block further clicks. The probe is pending only on
  // the very first mount (the cache is seeded on every write thereafter).
  const writePending = addFav.isPending || removeFav.isPending;
  const disabled = writePending || (isPending && status === null);

  const handleClick = async (): Promise<void> => {
    if (writePending) return;
    if (favorited && itemId) {
      try {
        await removeFav.mutateAsync({ itemId, businessId });
        toast.success(t('removed', { name: businessName }));
      } catch (err) {
        toast.error(mapFavoriteError(err, tRoot, t));
      }
      return;
    }
    try {
      await addFav.mutateAsync({ businessId });
      toast.success(t('saved', { name: businessName }));
    } catch (err) {
      toast.error(mapFavoriteError(err, tRoot, t));
    }
  };

  const { box, icon } = SIZE_PX[size];
  const label = favorited
    ? t('unsaveAction', { name: businessName })
    : t('saveAction', { name: businessName });

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={favorited}
      aria-label={label}
      title={label}
      data-testid="favorite-toggle"
      data-favorited={favorited ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-surface/90 text-text shadow-sm transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        box,
        className,
      )}
    >
      <Heart
        size={icon}
        aria-hidden
        // Filled heart in the brand danger color when favorited; outline otherwise.
        fill={favorited ? 'currentColor' : 'none'}
        className={cn(favorited ? 'text-danger' : 'text-text-subtle')}
      />
    </button>
  );
}

/** Map an ApiRequestError to a friendly i18n message; fall back to a generic error. */
function mapFavoriteError(
  err: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  t: ReturnType<typeof useTranslations>,
): string {
  if (!isApiRequestError(err)) return t('serverError');
  // 422 reason shapes from FavoritesService: max_items, max_lists,
  // reserved_name, default_list. The 409 «already in a list» is the move hint.
  if (err.code === 'CONFLICT') return t('alreadyFavorited');
  if (err.isRateLimited) return tRoot('auth.rateLimited');
  return tRoot(err.messageKey) ?? t('serverError');
}
