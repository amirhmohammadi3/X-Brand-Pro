'use client';

/**
 * BookingsCalendar (F7.5) — the `/dashboard/:businessId/bookings` "calendar"
 * tab.
 *
 * The owner's reservation console: a paginated, filterable list of the
 * business's bookings (newest first). Each row carries the booking's code,
 * service name, date/time, party size and status; the owner can confirm /
 * reject (pending) and mark no-show / complete (confirmed). The lifecycle
 * endpoints (`/decision`, `/no-show`, `/complete`) are POSTs that transition
 * the status; the result invalidates the whole calendar prefix so the row
 * flips in place.
 *
 * Two filters: `date` (one calendar day, `YYYY-MM-DD`) and `status` (one
 * lifecycle state). Both default to null = all. Pagination reuses the page
 * meta the API returns.
 *
 * Reject needs an optional reason; `ConfirmDialog` doesn't take children, so
 * a separate `Modal` carries the textarea.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { BookingStatus } from '@app/contracts';
import {
  useCompleteBooking,
  useDecideBooking,
  useMarkBookingNoShow,
  useOwnerBookings,
} from '../../lib/api/dashboard-bookings';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import { ConfirmDialog } from '../ui/confirm-dialog';
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Field,
  Heading,
  IconButton,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
} from '../ui';

const PAGE_SIZE = 20;
const STATUSES: ReadonlyArray<BookingStatus> = [
  'pending',
  'confirmed',
  'rejected',
  'cancelled',
  'completed',
  'no_show',
];

interface PendingAction {
  bookingId: string;
  kind: 'confirm' | 'reject' | 'noShow' | 'complete';
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type BadgeVariant = 'warning' | 'success' | 'danger' | 'neutral' | 'primary';

const STATUS_BADGE: Record<BookingStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  completed: 'primary',
  no_show: 'neutral',
};

export function BookingsCalendar({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [date, setDate] = useState<string | null>(null);
  const [status, setStatus] = useState<BookingStatus | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { result, isPending, error } = useOwnerBookings(businessId, {
    page,
    pageSize: PAGE_SIZE,
    ...(date ? { date } : {}),
    ...(status ? { status } : {}),
  });
  const decideMutation = useDecideBooking(businessId);
  const noShowMutation = useMarkBookingNoShow(businessId);
  const completeMutation = useCompleteBooking(businessId);

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={t('bookings.calendar.loading')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} />;
  }

  const bookings = result?.bookings ?? [];
  const meta = result?.meta;

  function statusBadge(s: BookingStatus) {
    return <Badge variant={STATUS_BADGE[s]}>{t(`bookings.calendar.status_${s}`)}</Badge>;
  }

  async function onConfirmAction() {
    if (!pendingAction) return;
    const { bookingId, kind } = pendingAction;
    try {
      if (kind === 'confirm') {
        await decideMutation.mutateAsync({ bookingId, body: { action: 'confirm' } });
      } else if (kind === 'noShow') {
        await noShowMutation.mutateAsync(bookingId);
      } else if (kind === 'complete') {
        await completeMutation.mutateAsync(bookingId);
      }
      toast.success(t('bookings.calendar.actionDone'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function onRejectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingAction) return;
    const { bookingId } = pendingAction;
    try {
      await decideMutation.mutateAsync({
        bookingId,
        body: { action: 'reject', reason: rejectReason.trim() || undefined },
      });
      toast.success(t('bookings.calendar.actionDone'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    } finally {
      setPendingAction(null);
      setRejectReason('');
    }
  }

  const today = todayIso();

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-bookings-calendar">
      <div>
        <Heading level="h2" className="text-lg">
          {t('bookings.calendar.title')}
        </Heading>
        <p className="text-sm text-text-subtle">{t('bookings.calendar.subtitle')}</p>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="min-w-48">
            <Field name="filter-date" label={t('bookings.calendar.dateLabel')}>
              {(props) => (
                <Select
                  {...props}
                  value={date ?? 'all'}
                  onChange={(e) => {
                    setDate(e.target.value === 'all' ? null : e.target.value);
                    setPage(1);
                  }}
                  options={[
                    { value: 'all', label: t('bookings.calendar.dateAll') },
                    ...buildDateOptions(today),
                  ]}
                />
              )}
            </Field>
          </div>
          <div className="min-w-48">
            <Field name="filter-status" label={t('bookings.calendar.statusLabel')}>
              {(props) => (
                <Select
                  {...props}
                  value={status ?? 'all'}
                  onChange={(e) => {
                    setStatus(e.target.value === 'all' ? null : (e.target.value as BookingStatus));
                    setPage(1);
                  }}
                  options={[
                    { value: 'all', label: t('bookings.calendar.statusAll') },
                    ...STATUSES.map((s) => ({
                      value: s,
                      label: t(`bookings.calendar.status_${s}`),
                    })),
                  ]}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              icon={ChevronRight}
              aria-label={t('bookings.calendar.prevDay')}
              onClick={() => {
                setDate((d) => (d ? addDays(d, -1) : addDays(today, -1)));
                setPage(1);
              }}
              variant="ghost"
              size="sm"
            />
            <IconButton
              icon={ChevronLeft}
              aria-label={t('bookings.calendar.nextDay')}
              onClick={() => {
                setDate((d) => (d ? addDays(d, 1) : addDays(today, 1)));
                setPage(1);
              }}
              variant="ghost"
              size="sm"
            />
            <Button variant="ghost" size="sm" onClick={() => setDate(null)}>
              {t('bookings.calendar.dateAll')}
            </Button>
          </div>
          {meta ? (
            <span className="ms-auto text-sm text-text-subtle">
              {t('bookings.calendar.count', { total: meta.total })}
            </span>
          ) : null}
        </CardBody>
      </Card>

      {bookings.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t('bookings.calendar.emptyTitle')}
          description={t('bookings.calendar.emptyMessage')}
        />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-text-subtle">
                  <th className="p-2 text-start font-medium">{t('bookings.calendar.colCode')}</th>
                  <th className="p-2 text-start font-medium">
                    {t('bookings.calendar.colService')}
                  </th>
                  <th className="p-2 text-start font-medium">{t('bookings.calendar.colDate')}</th>
                  <th className="p-2 text-start font-medium">{t('bookings.calendar.colTime')}</th>
                  <th className="p-2 text-start font-medium">{t('bookings.calendar.colParty')}</th>
                  <th className="p-2 text-start font-medium">{t('bookings.calendar.colStatus')}</th>
                  <th className="p-2 text-start font-medium">
                    {t('bookings.calendar.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-border-subtle">
                    <td className="p-2 font-mono" dir="ltr">
                      {b.code}
                    </td>
                    <td className="p-2">{b.serviceName}</td>
                    <td className="p-2 font-mono" dir="ltr">
                      {b.date}
                    </td>
                    <td className="p-2 font-mono" dir="ltr">
                      {b.startTime.slice(0, 5)}
                    </td>
                    <td className="p-2 text-center">{b.partySize}</td>
                    <td className="p-2">{statusBadge(b.status)}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {b.status === 'pending' ? (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={
                                pendingAction?.bookingId === b.id && decideMutation.isPending
                              }
                              onClick={() => setPendingAction({ bookingId: b.id, kind: 'confirm' })}
                            >
                              {t('bookings.calendar.confirm')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRejectReason('');
                                setPendingAction({ bookingId: b.id, kind: 'reject' });
                              }}
                            >
                              {t('bookings.calendar.reject')}
                            </Button>
                          </>
                        ) : null}
                        {b.status === 'confirmed' ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={
                                pendingAction?.bookingId === b.id && noShowMutation.isPending
                              }
                              onClick={() => setPendingAction({ bookingId: b.id, kind: 'noShow' })}
                            >
                              {t('bookings.calendar.noShow')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={
                                pendingAction?.bookingId === b.id && completeMutation.isPending
                              }
                              onClick={() =>
                                setPendingAction({ bookingId: b.id, kind: 'complete' })
                              }
                            >
                              {t('bookings.calendar.complete')}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {meta && meta.totalPages > 1 ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
      ) : null}

      {/* Confirm / no-show / complete — no extra input needed. */}
      <ConfirmDialog
        open={
          pendingAction !== null &&
          (pendingAction.kind === 'confirm' ||
            pendingAction.kind === 'noShow' ||
            pendingAction.kind === 'complete')
        }
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
        title={t('bookings.calendar.confirmTitle')}
        description={t('bookings.calendar.confirmMessage')}
        confirmLabel={
          pendingAction
            ? t(`bookings.calendar.${actionLabelKey(pendingAction.kind)}`)
            : t('bookings.calendar.confirm')
        }
        cancelLabel={t('bookings.services.cancel')}
        destructive={pendingAction?.kind === 'noShow'}
        onConfirm={onConfirmAction}
      />

      {/* Reject — needs an optional reason; ConfirmDialog has no children slot. */}
      <Modal
        open={pendingAction !== null && pendingAction.kind === 'reject'}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
            setRejectReason('');
          }
        }}
        title={t('bookings.calendar.reject')}
        description={t('bookings.calendar.rejectReason')}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingAction(null);
                setRejectReason('');
              }}
            >
              {t('bookings.services.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={pendingAction?.kind === 'reject' && decideMutation.isPending}
              onClick={(e) => void onRejectSubmit(e as unknown as React.FormEvent)}
            >
              {t('bookings.calendar.reject')}
            </Button>
          </>
        }
      >
        <Field name="reject-reason" label={t('bookings.calendar.rejectReason')}>
          {(props) => (
            <Input
              {...props}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
      </Modal>
    </div>
  );
}

function actionLabelKey(kind: PendingAction['kind']): string {
  switch (kind) {
    case 'confirm':
      return 'confirm';
    case 'reject':
      return 'reject';
    case 'noShow':
      return 'noShow';
    case 'complete':
      return 'complete';
  }
}

/** Build the recent-days dropdown options around `today` (±7 days). */
function buildDateOptions(today: string): Array<{ value: string; label: string }> {
  return Array.from({ length: 15 }, (_, i) => {
    const d = addDays(today, i - 7);
    return { value: d, label: d };
  });
}
