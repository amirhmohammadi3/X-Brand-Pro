'use client';

/**
 * HoursEditor (F7.2) — the weekly schedule section of
 * `/dashboard/:businessId/profile`.
 *
 * Seven weekday rows (locale-ordered: Saturday-first for fa, Sunday-first for
 * en — reuses `orderedWeekdays` from the display component). Each row is one
 * of: closed (no entry), all-day (`00:00`–`24:00`), or up to 3 open/close
 * intervals. On save the rows are folded into a `WeeklyHours` array (closed
 * days omitted) and PUT to `/businesses/:id/hours`. The B2.5 schema validates
 * duplicate weekdays, overlapping intervals and the allDay/intervals mutual
 * exclusion; server field errors land through the form-error surface.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import {
  type HoursResponse,
  type Interval,
  type WeeklyDay,
  type WeeklyHours,
} from '@app/contracts';
import { orderedWeekdays, WEEKDAY_NAMES } from '../business/business-hours';
import { useReplaceWeeklyHours } from '../../lib/api/business-hours';
import { isApiRequestError } from '../../lib/api/errors';
import { translateIssue } from '../../lib/forms/translate-issue';
import { useToast } from '../ui/toast';
import { Card, CardBody, CardHeader, Heading, IconButton } from '../ui';
import { SubmitButton } from '../ui/form';

export type DayMode = 'closed' | 'allDay' | 'intervals';

export interface DayState {
  mode: DayMode;
  intervals: Interval[];
}

const CLOSED_DAY: DayState = { mode: 'closed', intervals: [] };

function toDayState(day: WeeklyDay | undefined): DayState {
  if (!day) return CLOSED_DAY;
  if (day.allDay === true) return { mode: 'allDay', intervals: [] };
  return { mode: 'intervals', intervals: day.intervals ?? [] };
}

/** Fold the 7 row states into a `WeeklyHours` array (closed days omitted). */
export function buildWeekly(days: Record<number, DayState>): WeeklyHours {
  const weekly: WeeklyDay[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const state = days[weekday] ?? CLOSED_DAY;
    if (state.mode === 'closed') continue;
    if (state.mode === 'allDay') {
      weekly.push({ weekday, allDay: true });
    } else {
      const intervals = state.intervals.filter((iv) => iv.open && iv.close);
      if (intervals.length === 0) continue;
      weekly.push({ weekday, intervals });
    }
  }
  return weekly;
}

const FIRST_DAY_FA = 6; // Saturday
const FIRST_DAY_EN = 0; // Sunday

export function HoursEditor({ businessId, hours }: { businessId: string; hours: HoursResponse }) {
  const t = useTranslations('dashboard');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const replaceMutation = useReplaceWeeklyHours(businessId);
  const [formError, setFormError] = useState<string | null>(null);

  const names = (WEEKDAY_NAMES[locale] ?? WEEKDAY_NAMES.en) as Record<number, string>;
  const order = useMemo(
    () => orderedWeekdays(locale === 'fa' ? FIRST_DAY_FA : FIRST_DAY_EN),
    [locale],
  );

  const initial = useMemo(() => {
    const byWeekday = new Map<number, WeeklyDay>(hours.weekly.map((d) => [d.weekday, d]));
    const map: Record<number, DayState> = {};
    for (let weekday = 1; weekday <= 7; weekday++) {
      map[weekday] = toDayState(byWeekday.get(weekday));
    }
    return map;
  }, [hours.weekly]);

  const [days, setDays] = useState<Record<number, DayState>>(initial);

  const setMode = (weekday: number, mode: DayMode) =>
    setDays((prev) => {
      const day = prev[weekday] ?? CLOSED_DAY;
      return { ...prev, [weekday]: { ...day, mode } };
    });

  const setIntervalField = (weekday: number, idx: number, key: 'open' | 'close', value: string) =>
    setDays((prev) => {
      const day = prev[weekday] ?? CLOSED_DAY;
      const intervals = day.intervals.map((iv, i) => (i === idx ? { ...iv, [key]: value } : iv));
      return { ...prev, [weekday]: { ...day, intervals } };
    });

  const addInterval = (weekday: number) =>
    setDays((prev) => {
      const day = prev[weekday] ?? CLOSED_DAY;
      if (day.intervals.length >= 3) return prev;
      return {
        ...prev,
        [weekday]: { ...day, intervals: [...day.intervals, { open: '', close: '' }] },
      };
    });

  const removeInterval = (weekday: number, idx: number) =>
    setDays((prev) => {
      const day = prev[weekday] ?? CLOSED_DAY;
      return {
        ...prev,
        [weekday]: { ...day, intervals: day.intervals.filter((_, i) => i !== idx) },
      };
    });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const weekly = buildWeekly(days);
    try {
      await replaceMutation.mutateAsync(weekly);
      toast.success(t('hours.saved'));
    } catch (err) {
      if (!isApiRequestError(err)) {
        setFormError(tRoot('errors.internal_error'));
        return;
      }
      setFormError(translateIssue(tRoot, { message: err.messageKey }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <Heading level="h2" className="text-base">
          {t('hours.title')}
        </Heading>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {order.map((weekday) => {
            const day = days[weekday] ?? CLOSED_DAY;
            return (
              <div key={weekday} className="rounded-md border border-border-subtle p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{names[weekday]}</span>
                  <select
                    value={day.mode}
                    onChange={(e) => setMode(weekday, e.target.value as DayMode)}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                    aria-label={names[weekday]}
                  >
                    <option value="closed">{t('hours.closed')}</option>
                    <option value="allDay">{t('hours.allDay')}</option>
                    <option value="intervals">{t('hours.intervals')}</option>
                  </select>
                </div>
                {day.mode === 'intervals' && (
                  <div className="mt-3 space-y-2">
                    {day.intervals.map((iv, idx) => (
                      <div key={idx} className="flex items-end gap-2">
                        <label className="flex flex-col gap-1 text-xs text-text-subtle">
                          {t('hours.open')}
                          <input
                            type="time"
                            value={iv.open}
                            onChange={(e) => setIntervalField(weekday, idx, 'open', e.target.value)}
                            dir="ltr"
                            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-text-subtle">
                          {t('hours.close')}
                          <input
                            type="time"
                            value={iv.close}
                            onChange={(e) =>
                              setIntervalField(weekday, idx, 'close', e.target.value)
                            }
                            dir="ltr"
                            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
                          />
                        </label>
                        <IconButton
                          icon={Trash2}
                          aria-label={t('hours.removeInterval')}
                          onClick={() => removeInterval(weekday, idx)}
                          variant="ghost"
                          size="sm"
                        />
                      </div>
                    ))}
                    {day.intervals.length < 3 && (
                      <button
                        type="button"
                        onClick={() => addInterval(weekday)}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Plus className="size-4" aria-hidden />
                        {t('hours.addInterval')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {formError && <p className="text-sm text-danger">{formError}</p>}
          <div className="flex justify-end">
            <SubmitButton loading={replaceMutation.isPending}>{t('hours.save')}</SubmitButton>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
