'use client';

/**
 * MyBookingsView (F6.2) — «رزروهای من». The user's bookings split into
 * upcoming / past (the server's own scope partition — the list endpoint
 * computes it against the Tehran wall clock), with status filter chips, a
 * page-based list and the per-booking actions:
 *
 * - **Cancel** — a confirm dialog, then `POST /bookings/:id/cancel`; the
 *   B6.3 policy window is server-enforced (a 422 cancel_window lands in
 *   the toast, never a silent failure);
 * - **Calendar feed** — fetches the B6.4 HMAC token and shows the ready
 *   feed URL with a CopyButton (the URL itself is the auth).
 *
 * Status badges render the lifecycle vocabulary; dates go through the
 * locale formatter (Jalali in `fa`), times stay as the local wall clock
 * the API stores.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Users } from 'lucide-react';
import {
  useCancelBooking,
  useCalendarToken,
  useMyBookings,
  BOOKING_STATUS_FILTERS,
} from '../../lib/api/bookings';
import { useAuth } from '../../lib/auth/auth-context';
import { isApiRequestError } from '../../lib/api/errors';
import type { Booking, BookingStatus } from '@app/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  Pagination,
  Spinner,
} from '../ui';
import { useToast } from '../ui/toast';
import { cn } from '../../lib/cn';

const STATUS_VARIANT: Record<BookingStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  cancelled: 'danger',
  completed: 'neutral',
  no_show: 'danger',
};

type Scope = 'upcoming' | 'past';

export function MyBookingsView() {
  const t = useTranslations('bookings');
  const locale = useLocale();
  const { user } = useAuth();
  const toast = useToast();

  const [scope, setScope] = useState<Scope>('upcoming');
  const [statusFilter, setStatusFilter] = useState<BookingStatus | null>(null);
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<Booking | null>(null);

  const list = useMyBookings({ scope, status: statusFilter ?? undefined, page, pageSize: 10 });
  const cancel = useCancelBooking();
  const token = useCalendarToken(scope === 'upcoming' && user !== null);

  const dateFormatter = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const doCancel = (): void => {
    if (!cancelling) return;
    cancel.mutate(
      { bookingId: cancelling.id },
      {
        onSuccess: () => {
          toast.success(t('mine.cancelled'));
          setCancelling(null);
        },
        onError: (error) => {
          if (isApiRequestError(error)) {
            const key =
              (error.details as { reason?: string } | undefined)?.reason === 'cancel_window'
                ? 'errors.cancelWindow'
                : 'errors.generic';
            toast.error(t(key));
          } else {
            toast.error(t('errors.generic'));
          }
          setCancelling(null);
        },
      },
    );
  };

  if (list.isLoading) {
    return (
      <div className="flex justify-center py-10" role="status">
        <Spinner />
      </div>
    );
  }
  if (list.isError) {
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  }

  const { bookings, meta } = list.data ?? { bookings: [], meta: null };
  const feedUrl =
    token.data && user ? `/bookings/user/${user.id}/calendar.ics?token=${token.data.token}` : null;

  return (
    <div className="flex flex-col gap-5" data-testid="my-bookings">
      {/* scope tabs */}
      <div role="tablist" aria-label={t('mine.scopeLabel')} className="flex gap-2">
        {(['upcoming', 'past'] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            onClick={() => {
              setScope(s);
              setPage(1);
            }}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm transition-colors',
              scope === s
                ? 'bg-primary text-primary-fg'
                : 'bg-surface text-text hover:bg-surface-muted',
            )}
          >
            {t(`mine.scope.${s}`)}
          </button>
        ))}
      </div>

      {/* status chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => {
            setStatusFilter(null);
            setPage(1);
          }}
          className={cn(
            'rounded-full border px-3 py-1 text-xs transition-colors',
            statusFilter === null
              ? 'border-primary text-primary'
              : 'border-border-subtle text-muted hover:border-primary',
          )}
        >
          {t('mine.allStatuses')}
        </button>
        {BOOKING_STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              statusFilter === s
                ? 'border-primary text-primary'
                : 'border-border-subtle text-muted hover:border-primary',
            )}
          >
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      {/* calendar feed (upcoming tab only — that is what a calendar wants) */}
      {scope === 'upcoming' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-text">
            <CalendarDays size={16} aria-hidden />
            {t('mine.feedTitle')}
          </div>
          <p className="text-muted">{t('mine.feedHint')}</p>
          {feedUrl ? (
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded bg-surface-muted px-2 py-1 text-xs"
              >
                {feedUrl}
              </code>
              <CopyButton value={feedUrl} label={t('mine.feedCopy')} />
            </div>
          ) : (
            <Spinner size="sm" />
          )}
        </div>
      ) : null}

      {/* the list */}
      {bookings.length === 0 ? (
        <EmptyState icon={CalendarDays} title={t('mine.empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {bookings.map((booking) => (
            <li
              key={booking.id}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
              data-testid="booking-row"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-text">
                  <span>{dateFormatter.format(new Date(`${booking.date}T12:00:00`))}</span>
                  <span aria-hidden>·</span>
                  <span dir="ltr" className="tabular-nums">
                    {booking.startTime.slice(0, 5)}–{booking.endTime.slice(0, 5)}
                  </span>
                </div>
                <Badge variant={STATUS_VARIANT[booking.status]}>
                  {t(`status.${booking.status}`)}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                <span>{booking.businessName}</span>
                <span>{booking.serviceName}</span>
                <span className="flex items-center gap-1">
                  <Users size={14} aria-hidden />
                  {booking.partySize}
                </span>
                <span dir="ltr" className="font-mono text-xs">
                  {booking.code}
                </span>
              </div>
              {booking.cancelReason ? (
                <p className="text-xs text-muted">
                  {t('mine.cancelReason', { reason: booking.cancelReason })}
                </p>
              ) : null}
              {scope === 'upcoming' &&
              (booking.status === 'pending' || booking.status === 'confirmed') ? (
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCancelling(booking)}
                    aria-label={t('mine.cancelAria')}
                  >
                    {t('mine.cancel')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          onPageChange={(p) => setPage(p)}
        />
      ) : null}

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
        title={t('mine.cancelTitle')}
        description={t('mine.cancelBody', { code: cancelling?.code ?? '' })}
        confirmLabel={t('mine.cancelConfirm')}
        cancelLabel={t('mine.cancelDismiss')}
        destructive
        onConfirm={doCancel}
      />
    </div>
  );
}
