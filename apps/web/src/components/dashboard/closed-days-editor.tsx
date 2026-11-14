'use client';

/**
 * ClosedDaysEditor (F7.5) — the `/dashboard/:businessId/bookings` "closed
 * days" tab.
 *
 * The owner's full-day booking closures (روزهای تعطیل) — distinct from the
 * working-hours special days (`business_special_days`, F7.2): the owner may
 * keep the café open but stop taking reservations for a private event, so
 * booking closures need their own calendar. Adding a date is `POST
 * /bookings/closed-days/:businessId`; removing is `DELETE
 * /bookings/closed-days/:businessId/:date` (idempotent — the API returns the
 * same date whether or not a row was deleted).
 *
 * The date input is a plain `<input type="date">` (Gregorian) — the API
 * accepts `YYYY-MM-DD`. A 409 (`closed_day_exists`) is rendered as a friendly
 * inline error, not a toast, so the owner sees which date collided.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import {
  useBookingClosedDays,
  useCreateBookingClosedDay,
  useDeleteBookingClosedDay,
} from '../../lib/api/dashboard-bookings';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Heading,
  IconButton,
  Spinner,
  Field,
  Input,
  FormError,
} from '../ui';

export function ClosedDaysEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const toast = useToast();
  const { days, isPending, error } = useBookingClosedDays(businessId);
  const createMutation = useCreateBookingClosedDay(businessId);
  const deleteMutation = useDeleteBookingClosedDay(businessId);

  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (date === '') return;
    try {
      await createMutation.mutateAsync({
        date,
        note: note.trim() === '' ? undefined : note.trim(),
      });
      toast.success(t('bookings.closedDays.added'));
      setDate('');
      setNote('');
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      if (err.status === 409) {
        setFormError(t('bookings.closedDays.exists'));
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  }

  async function onRemove(day: { date: string }) {
    try {
      await deleteMutation.mutateAsync(day.date);
      toast.success(t('bookings.closedDays.removed'));
    } catch (err) {
      toast.error(
        isApiRequestError(err)
          ? translateIssue(tRoot, { message: err.messageKey })
          : tRoot('errors.internal_error'),
      );
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={t('bookings.closedDays.loading')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-bookings-closed-days">
      <div>
        <Heading level="h2" className="text-lg">
          {t('bookings.closedDays.title')}
        </Heading>
        <p className="text-sm text-text-subtle">{t('bookings.closedDays.subtitle')}</p>
      </div>

      <Card>
        <CardBody>
          <form
            onSubmit={onAdd}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            noValidate
          >
            <div className="flex-1">
              <Field name="cd-date" label={t('bookings.closedDays.date')}>
                {(props) => (
                  <input
                    {...props}
                    type="date"
                    dir="ltr"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
                  />
                )}
              </Field>
            </div>
            <div className="flex-1">
              <Field name="cd-note" label={t('bookings.closedDays.note')}>
                {(props) => (
                  <Input
                    {...props}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('bookings.closedDays.notePlaceholder')}
                    maxLength={200}
                  />
                )}
              </Field>
            </div>
            <Button type="submit" variant="primary" loading={createMutation.isPending}>
              <Plus className="size-4" aria-hidden />
              {t('bookings.closedDays.add')}
            </Button>
          </form>
          {formError ? (
            <FormError
              errors={[
                {
                  name: 'cd-form',
                  label: t('bookings.closedDays.title'),
                  message: formError,
                },
              ]}
            />
          ) : null}
        </CardBody>
      </Card>

      {days.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title={t('bookings.closedDays.emptyTitle')}
          description={t('bookings.closedDays.emptyMessage')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {days.map((day) => (
            <li key={day.id}>
              <Card>
                <CardBody className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <time className="font-mono text-sm text-text" dateTime={day.date} dir="ltr">
                      {day.date}
                    </time>
                    {day.note ? <span className="text-sm text-text-subtle">{day.note}</span> : null}
                  </div>
                  <IconButton
                    icon={Trash2}
                    aria-label={t('bookings.closedDays.delete')}
                    onClick={() => onRemove(day)}
                    variant="ghost"
                    size="sm"
                  />
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
