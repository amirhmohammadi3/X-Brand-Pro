'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DatePicker,
  DateRangePicker,
  TimePicker,
  DateTimePicker,
  MonthYearJumper,
  NumberInput,
  Card,
  CardBody,
  CardHeader,
  Heading,
  Button,
} from '../../../../components/ui';
import { getCalendarSystem, type CalendarParts } from '../../../../lib/calendar/calendar-system';

/**
 * Date + number playground (F1.6). Each component is mounted in the active
 * locale so switching `/fa` vs `/en` shows the Jalali vs Gregorian grid and
 * Persian vs ASCII digits. The current ISO values are shown below each control
 * so you can verify by hand that typing `1405/01/01` yields `2026-03-21`.
 */
export function DatePlayground() {
  const t = useTranslations('form');
  const locale = useLocale();
  const sys = getCalendarSystem(locale);

  const [date, setDate] = useState<string | null>('2026-03-21');
  const [range, setRange] = useState<[string | null, string | null]>([null, null]);
  const [time, setTime] = useState<string | null>('12:00');
  const [dt, setDt] = useState<string | null>('2026-03-21T12:00');
  const [num, setNum] = useState<number | null>(1234567);
  const [toman, setToman] = useState<number | null>(3500000);
  const [view, setView] = useState<CalendarParts>(() => {
    const parts = sys.fromDate(new Date());
    return { year: parts.year, month: parts.month, day: 1 };
  });

  return (
    <Card>
      <CardHeader>
        <Heading level="h2">{t('playground.dateTitle') ?? 'Date & number'}</Heading>
      </CardHeader>
      <CardBody className="space-y-6">
        <section className="space-y-2">
          <label className="text-sm font-medium text-text">
            {t('playground.dateTitle') ?? 'Date'}
          </label>
          <DatePicker value={date} onChange={setDate} />
          <p className="text-xs text-text-subtle">ISO: {date ?? '—'}</p>
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Range</label>
          <DateRangePicker value={range} onChange={setRange} />
          <p className="text-xs text-text-subtle">
            {range[0] ?? '—'} → {range[1] ?? '—'}
          </p>
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Time</label>
          <TimePicker value={time} onChange={setTime} step={15} />
          <p className="text-xs text-text-subtle">{time ?? '—'}</p>
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium text-text">DateTime</label>
          <DateTimePicker value={dt} onChange={setDt} step={30} />
          <p className="text-xs text-text-subtle">{dt ?? '—'}</p>
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Number</label>
          <NumberInput value={num} onChange={setNum} min={0} step={1} />
          <p className="text-xs text-text-subtle">value: {num ?? '—'}</p>
          <NumberInput value={toman} onChange={setToman} currency aria-label="Toman" />
        </section>

        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Month/Year jumper</label>
          <div className="rounded-md border border-border-subtle p-3">
            <MonthYearJumper value={view} onChange={setView} />
            <p className="mt-2 text-xs text-text-subtle">
              {sys.getMonthName(view.month)} {view.year}
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <Button
            variant="ghost"
            onClick={() => {
              setDate(null);
              setRange([null, null]);
              setTime(null);
              setDt(null);
              setNum(null);
              setToman(null);
            }}
          >
            Reset
          </Button>
        </section>
      </CardBody>
    </Card>
  );
}
