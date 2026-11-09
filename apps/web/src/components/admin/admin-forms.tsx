'use client';

import type { LucideIcon } from 'lucide-react';
import * as Lucide from 'lucide-react';
import { CATEGORY_ICONS, AMENITY_ICONS } from '@app/contracts';
import { Field } from '../ui/form/field';
import { Input } from '../ui/form/input';
import { Select, type SelectOption } from '../ui/form/select';
import { Text } from '../ui/text';

/**
 * Shared admin form building blocks (F2.2). The catalog entities carry a
 * `LocalizedText` (`{ fa: string; en?: string }`) and a curated icon name —
 * every admin form composes the same pieces, so they live here once. Forms
 * are controlled (the profile-form pattern): string state per field, parsed
 * and validated against a local zod schema on submit.
 *
 * Icons render from the exact Lucide names the contracts allow-list
 * (B2.2/B2.3); an unknown name renders a neutral dot instead of crashing.
 */

/** Resolve a contracts icon name to its Lucide component (or null). */
export function iconByName(name: string): LucideIcon | null {
  const candidate = (Lucide as unknown as Record<string, unknown>)[name];
  return typeof candidate === 'function' ? (candidate as LucideIcon) : null;
}

const CATEGORY_OPTIONS: ReadonlyArray<SelectOption> = CATEGORY_ICONS.map((name) => ({
  value: name,
  label: name,
}));
const AMENITY_OPTIONS: ReadonlyArray<SelectOption> = AMENITY_ICONS.map((name) => ({
  value: name,
  label: name,
}));

/** The `fa` (required) + `en` (optional) text pair of a LocalizedText. */
export function LocalizedTextFields({
  labelFa,
  labelEn,
  faValue,
  enValue,
  onFaChange,
  onEnChange,
  faError,
  nameBase = 'name',
}: {
  labelFa: string;
  labelEn: string;
  faValue: string;
  enValue: string;
  onFaChange: (value: string) => void;
  onEnChange: (value: string) => void;
  faError?: string;
  nameBase?: string;
}) {
  return (
    <>
      <Field name={`${nameBase}Fa`} label={labelFa} required error={faError}>
        {(props) => (
          <Input
            {...props}
            value={faValue}
            onChange={(event) => onFaChange(event.target.value)}
            maxLength={120}
          />
        )}
      </Field>
      <Field name={`${nameBase}En`} label={labelEn}>
        {(props) => (
          <Input
            {...props}
            value={enValue}
            onChange={(event) => onEnChange(event.target.value)}
            maxLength={120}
            dir="ltr"
          />
        )}
      </Field>
    </>
  );
}

/** A numeric text field (lat/lng/bbox edges, sortOrder) with LTR digits. */
export function NumberField({
  name,
  label,
  value,
  onChange,
  error,
  step = 'any',
  placeholder,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  step?: string;
  placeholder?: string;
}) {
  return (
    <Field name={name} label={label} error={error}>
      {(props) => (
        <Input
          {...props}
          type="number"
          inputMode="decimal"
          step={step}
          dir="ltr"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** A `Select` of the contracts icon allow-list with a live icon preview. */
export function IconSelect({
  id,
  value,
  onChange,
  kind,
  label,
  error,
}: {
  id?: string;
  value: string;
  onChange: (name: string) => void;
  kind: 'category' | 'amenity';
  label: string;
  error?: string;
}) {
  const options = kind === 'category' ? CATEGORY_OPTIONS : AMENITY_OPTIONS;
  const Preview = iconByName(value);
  return (
    <Field name={id ?? 'icon'} label={label} error={error}>
      {(props) => (
        <div className="flex items-center gap-2">
          <Select
            {...props}
            options={options}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="flex-1"
          />
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border-subtle"
          >
            {Preview ? (
              <Preview size={18} aria-hidden />
            ) : (
              <span className="h-2 w-2 rounded-full bg-muted" />
            )}
          </span>
        </div>
      )}
    </Field>
  );
}

/** A generic string `Select` bound to controlled state. */
export function StringSelect({
  id,
  label,
  value,
  onChange,
  options,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  error?: string;
}) {
  return (
    <Field name={id} label={label} error={error}>
      {(props) => (
        <Select
          {...props}
          options={options}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Muted helper line inside a form (e.g. slug auto-generation hint). */
export function FormHint({ children }: { children: React.ReactNode }) {
  return (
    <Text as="p" size="xs" muted>
      {children}
    </Text>
  );
}

/**
 * Translate a zod issue message (an i18n key such as `validation.required`
 * or `admin.cities.centerOutside`) through the ROOT translator. next-intl
 * types keys as literals; the form schemas emit a small closed set that is
 * covered by the seeds, so the cast is safe at runtime.
 */
export function translateIssue(
  tRoot: { (key: string): string },
  key: string | undefined,
): string | undefined {
  if (!key) return undefined;
  const typed = tRoot as unknown as (k: string) => string;
  return typed(key);
}
