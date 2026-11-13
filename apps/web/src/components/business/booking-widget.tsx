'use client';

/**
 * BookingWidget (F6.1) — the booking flow on the business page. Four steps
 * in one card, server-gated at every turn:
 *
 * 1. **Service** — the business's active bookable services
 *    (`GET /bookings/services?businessId=`, public). A business without
 *    booking services renders nothing (the section disappears, no stub).
 * 2. **Date** — the DatePicker (Jalali for `fa` via the F1.6 calendar
 *    engine) bounded by today…today+`maxAdvanceDays`.
 * 3. **Slot** — the availability grid for (service, date); only
 *    `available` slots are clickable (full/past-the-lead ones render
 *    disabled — the engine already answered, no client guessing).
 * 4. **Confirm** — party size (service bounds), contact name/phone
 *    (prefilled from the session), optional note → `POST /bookings`.
 *    The success state shows the booking code (the owner's reference).
 *
 * Login gate: an anonymous visitor can browse services/dates/slots (the
 * reads are public) but the submit renders a login link instead — mirroring
 * the FollowButton gate. Every 4xx lands in the toast through
 * `useApiMutation`'s error handling; the slot_full 409 refreshes the
 * availability cache so the grid flips without a manual reload.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarDays, CheckCircle2, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth-context';
import { isApiRequestError } from '../../lib/api/errors';
import { useAvailability, useBookingServices, useCreateBooking } from '../../lib/api/bookings';
import { Badge, Button, Input, Label, Spinner, Textarea } from '../ui';
import { DatePicker } from '../ui/date';
import { useToast } from '../ui/toast';
import { cn } from '../../lib/cn';

export interface BookingWidgetProps {
  businessId: string;
}

/** ISO `YYYY-MM-DD` of "today" in the browser's local calendar. */
function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** `HH:mm` slots render as stored (the tabular grid is locale-neutral). */
export function BookingWidget({ businessId }: BookingWidgetProps) {
  const t = useTranslations('bookings');
  const { user, status } = useAuth();
  const toast = useToast();

  const services = useBookingServices(businessId);
  const list = services.data?.services ?? [];

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayIso());
  const [slot, setSlot] = useState<string | null>(null);
  const [partySize, setPartySize] = useState<number>(1);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [note, setNote] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const active = useMemo(() => list.find((s) => s.id === serviceId) ?? null, [list, serviceId]);

  // Reset the flow when the service changes (bounds/grid differ per service).
  useEffect(() => {
    setSlot(null);
    setCreatedCode(null);
    if (active) setPartySize(Math.max(active.minPartySize, 1));
  }, [active]);

  // Prefill the contact fields from the session once it resolves.
  useEffect(() => {
    if (!user) return;
    setContactName((prev) => prev || user.displayName || user.username);
    setContactPhone((prev) => prev || user.phone || '');
  }, [user]);

  const availability = useAvailability(active?.id ?? null, active ? date : null);
  const slots = availability.data?.closed ? [] : (availability.data?.slots ?? []);
  const bookableSlots = slots.filter((s) => s.available);

  const create = useCreateBooking();

  const submit = (): void => {
    if (!active || !slot) return;
    create.mutate(
      {
        businessId,
        serviceId: active.id,
        date,
        startTime: slot,
        partySize,
        contactName: contactName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          // Keep the slot — the success card renders in its place.
          setCreatedCode(result.booking.code);
          toast.success(t('widget.created', { code: result.booking.code }));
        },
        onError: (error) => {
          if (isApiRequestError(error)) {
            toast.error(t(`errors.${error.messageKey.split('.').pop() ?? 'generic'}`));
          } else {
            toast.error(t('errors.generic'));
          }
        },
      },
    );
  };

  if (services.isLoading) {
    return (
      <div className="flex items-center justify-center py-6" role="status">
        <Spinner />
      </div>
    );
  }

  // A business without booking services simply has no widget (F6.1 decision:
  // the section is opt-in per business — no empty shell on the page).
  if (list.length === 0) return null;

  const min = todayIso();
  const max = active ? addDaysIso(min, active.maxAdvanceDays) : addDaysIso(min, 30);

  return (
    <div className="flex flex-col gap-4" data-testid="booking-widget">
      {/* Step 1 — service */}
      <div className="flex flex-col gap-2">
        <Label>{t('widget.service')}</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('widget.service')}>
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === serviceId}
              onClick={() => setServiceId(s.id)}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm transition-colors',
                s.id === serviceId
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border-subtle bg-surface text-text hover:border-primary',
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
        {active?.description ? <p className="text-sm text-muted">{active.description}</p> : null}
      </div>

      {active ? (
        <>
          {/* Step 2 — date */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="booking-date">{t('widget.date')}</Label>
            <DatePicker
              value={date}
              onChange={(iso) => {
                if (iso) {
                  setDate(iso);
                  setSlot(null);
                }
              }}
              min={min}
              max={max}
              clearable={false}
              aria-label={t('widget.date')}
            />
          </div>

          {/* Step 3 — slots */}
          <div className="flex flex-col gap-2">
            <Label>{t('widget.slots')}</Label>
            {availability.isFetching ? (
              <div className="flex justify-center py-3" role="status">
                <Spinner />
              </div>
            ) : availability.isError ? (
              <p className="text-sm text-danger">{t('errors.generic')}</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted">{t('widget.closed')}</p>
            ) : (
              <div
                className="grid grid-cols-4 gap-2 sm:grid-cols-6"
                role="radiogroup"
                aria-label={t('widget.slots')}
              >
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    role="radio"
                    aria-checked={s.start === slot}
                    disabled={!s.available}
                    onClick={() => setSlot(s.start)}
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-sm tabular-nums transition-colors',
                      s.start === slot && 'border-primary bg-primary text-primary-fg',
                      !s.available &&
                        'cursor-not-allowed border-border-subtle text-muted line-through opacity-50',
                      s.available &&
                        s.start !== slot &&
                        'border-border-subtle bg-surface hover:border-primary',
                    )}
                  >
                    {s.start}
                  </button>
                ))}
              </div>
            )}
            {!availability.isFetching && slots.length > 0 && bookableSlots.length === 0 ? (
              <p className="text-sm text-muted">{t('widget.allTaken')}</p>
            ) : null}
          </div>

          {/* Step 4 — confirm */}
          {slot ? (
            createdCode ? (
              <div
                className="flex flex-col gap-1 rounded-lg border border-success bg-success/10 p-4"
                data-testid="booking-success"
              >
                <div className="flex items-center gap-2 text-success">
                  <CheckCircle2 size={18} aria-hidden />
                  <span className="font-medium">{t('widget.successTitle')}</span>
                </div>
                <p className="text-sm text-text">
                  {t('widget.successBody', { status: 'pending' })}
                </p>
                <Badge variant="neutral">{t('widget.code', { code: createdCode })}</Badge>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
                <div className="flex items-center gap-2 text-sm text-text">
                  <CalendarDays size={16} aria-hidden />
                  <span dir="ltr" className="tabular-nums">
                    {slot}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{active.name}</span>
                </div>

                <div className="flex items-center gap-3">
                  <Label htmlFor="booking-party" className="flex items-center gap-1">
                    <Users size={14} aria-hidden />
                    {t('widget.party')}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPartySize((p) => Math.max(active.minPartySize, p - 1))}
                      disabled={partySize <= active.minPartySize}
                      aria-label={t('widget.partyMinus')}
                    >
                      −
                    </Button>
                    <span className="min-w-8 text-center tabular-nums">{partySize}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPartySize((p) => Math.min(active.maxPartySize, p + 1))}
                      disabled={partySize >= active.maxPartySize}
                      aria-label={t('widget.partyPlus')}
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="booking-name">{t('widget.contactName')}</Label>
                  <Input
                    id="booking-name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    maxLength={80}
                    autoComplete="name"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="booking-phone">{t('widget.contactPhone')}</Label>
                  <Input
                    id="booking-phone"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    inputMode="tel"
                    dir="ltr"
                    placeholder="0912 345 6789"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <Label htmlFor="booking-note">{t('widget.note')}</Label>
                  <Textarea
                    id="booking-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                  />
                </div>

                {status === 'authenticated' ? (
                  <Button onClick={submit} disabled={create.isPending}>
                    {create.isPending ? <Spinner size="sm" /> : t('widget.submit')}
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
                    <span className="text-muted">{t('widget.loginHint')}</span>
                    <Link href="/login" className="font-medium text-primary hover:underline">
                      {t('widget.login')}
                    </Link>
                  </div>
                )}
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}
