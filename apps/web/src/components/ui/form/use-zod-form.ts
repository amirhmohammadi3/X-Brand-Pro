import { useCallback, useMemo, useRef } from 'react';
import {
  useForm,
  type UseFormProps,
  type UseFormReturn,
  type FieldValues,
  type DefaultValues,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodType } from 'zod';
import type { FieldIssue } from '../../../lib/api/use-api-mutation';

/**
 * `useZodForm` (F1.4) — the form hook every form in the app uses.
 *
 * Wraps react-hook-form's `useForm` with the Zod resolver and the platform's
 * standard validation modes:
 *   - `mode: 'onBlur'` — validate a field when the user leaves it (avoids
 *     shouting at someone mid-typing).
 *   - `reValidateMode: 'onChange'` — once a field is invalid, re-validate on
 *     every keystroke so the error clears as soon as it's fixed.
 *
 * On top of the RHF methods it exposes `setServerErrors(fieldErrors)`, which
 * takes the map returned by `useApiMutation().fieldErrors(error)` (from the
 * `VALIDATION_FAILED` envelope) and:
 *   1. stamps each server issue onto the matching field via `setError`,
 *   2. focuses the first invalid field (the input rendered by `<Controller
 *      name=... />` carries the field name on its DOM node via
 *      `data-field-name`, set by the `Field`/`Input` components).
 *
 * Zod schemas in this app put a translation KEY in `message`
 * (`validation.required`, `validation.min` with params). The `Field`
 * component renders the raw key through next-intl at display time, so the
 * hook itself stays locale-agnostic.
 */
export interface UseZodFormReturn<TFieldValues extends FieldValues>
  extends UseFormReturn<TFieldValues> {
  setServerErrors: (fieldErrors: Record<string, FieldIssue[]>) => void;
}

export interface UseZodFormOptions<TFieldValues extends FieldValues>
  extends Omit<UseFormProps<TFieldValues>, 'resolver'> {
  /** Override the resolver (rare; defaults to zodResolver(schema)). */
  resolver?: UseFormProps<TFieldValues>['resolver'];
}

export function useZodForm<TFieldValues extends FieldValues>(
  schema: ZodType<TFieldValues>,
  options: UseZodFormOptions<TFieldValues> = {},
): UseZodFormReturn<TFieldValues> {
  const {
    defaultValues,
    values,
    resolver,
    mode = 'onBlur',
    reValidateMode = 'onChange',
    ...rest
  } = options;

  const formProps: UseFormProps<TFieldValues> = useMemo(
    () => ({
      resolver: resolver ?? zodResolver(schema),
      mode,
      reValidateMode,
      defaultValues: defaultValues as DefaultValues<TFieldValues>,
      values,
      ...rest,
    }),
    [schema, mode, reValidateMode],
  );

  const methods = useForm<TFieldValues>(formProps);

  // Track the order in which fields first received errors so we can focus the
  // earliest one. Using a ref keeps this out of render.
  const firstInvalidRef = useRef<string | null>(null);

  const setServerErrors = useCallback(
    (fieldErrors: Record<string, FieldIssue[]>) => {
      firstInvalidRef.current = null;
      const names = Object.keys(fieldErrors);
      for (const name of names) {
        const issues = fieldErrors[name];
        if (!issues || issues.length === 0) continue;
        // Server issues are translation keys (string) or { key, params }.
        const first = issues[0];
        const message = typeof first === 'string' ? first : (first?.key ?? '');
        methods.setError(
          name as Parameters<typeof methods.setError>[0],
          {
            type: 'server',
            message,
          },
          { shouldFocus: false },
        );
        if (firstInvalidRef.current === null) {
          firstInvalidRef.current = name;
        }
      }
      // Focus the first invalid field. The Field/Input components tag their
      // DOM node with `data-field-name` so we can locate it without RHF refs.
      const firstName = firstInvalidRef.current;
      if (firstName) {
        // Defer to next frame so the error UI has painted.
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-field-name="${CSS.escape(firstName)}"]`,
          );
          el?.focus();
        });
      }
    },
    [methods],
  );

  return Object.assign(methods, { setServerErrors });
}
