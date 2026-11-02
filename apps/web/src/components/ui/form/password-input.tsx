import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../../lib/cn';
import { Input } from './input';

export interface PasswordInputProps extends Omit<React.ComponentProps<typeof Input>, 'type'> {
  /** Show the strength meter under the input. */
  showStrength?: boolean;
  /** Accessible field name for `data-field-name` (focus targeting). */
  name?: string;
  /** Override the label rendered for the meter. */
  label?: ReactNode;
}

/**
 * `PasswordInput` (F1.4) — `Input type="password"` plus a strength meter.
 *
 * The meter scores 0-4 from length and character variety only (no entropy
 * estimation, no dictionary checks — those belong server-side). The label is
 * visible text (`form.passwordStrength.<n>`), never color alone, so it works
 * for color-blind users and high-contrast modes. The visible bar is a
 * secondary cue.
 */
export function PasswordInput({
  showStrength = true,
  name,
  value,
  id,
  ...rest
}: PasswordInputProps) {
  const t = useTranslations('form.passwordStrength');
  const stringValue = typeof value === 'string' ? value : '';

  const score = useMemo(() => scorePassword(stringValue), [stringValue]);

  return (
    <div className="flex flex-col gap-1.5">
      <Input {...rest} id={id} type="password" name={name} value={value} data-field-name={name} />
      {showStrength ? (
        <div className="flex items-center gap-2" aria-live="polite">
          <div
            className="flex h-1.5 flex-1 gap-1"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={score}
            aria-label={t('label')}
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  'h-full flex-1 rounded-full transition-colors',
                  i < score ? strengthColor(score) : 'bg-surface-alt',
                )}
              />
            ))}
          </div>
          <span className="text-xs text-text-subtle min-w-[3.5rem] text-end">
            {t(String(score))}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function strengthColor(score: number): string {
  // 0-1 red, 2 amber, 3-4 green. Text label is the primary cue; color is
  // secondary and only ever reinforces the label.
  if (score <= 1) return 'bg-danger';
  if (score === 2) return 'bg-amber-500';
  return 'bg-success';
}

/**
 * Score 0-4 from length and character variety. Varieties counted: lower,
 * upper, digit, symbol. Length bands: <8 → 0, ≥8 → +1, ≥12 → +1.
 */
export function scorePassword(pw: string): number {
  if (!pw) return 0;
  let varieties = 0;
  if (/[a-z]/.test(pw)) varieties += 1;
  if (/[A-Z]/.test(pw)) varieties += 1;
  if (/\d/.test(pw)) varieties += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) varieties += 1;

  let lengthBonus = 0;
  if (pw.length >= 8) lengthBonus += 1;
  if (pw.length >= 12) lengthBonus += 1;

  // Combine: variety is the main signal, length reinforces it.
  const raw = varieties + lengthBonus; // 0..6
  // Map to 0..4.
  if (raw <= 1) return 0;
  if (raw === 2) return 1;
  if (raw === 3) return 2;
  if (raw === 4) return 3;
  return 4;
}
