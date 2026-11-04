'use client';

import { Field, Input } from '../ui/form';

export interface IdentifierFieldProps {
  /** Field name (also `data-field-name` for focus targeting). */
  name?: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** `autocomplete` hint for password managers (login vs register). */
  autoComplete?: 'username' | 'email' | 'off';
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * `IdentifierField` (F1.8). The "username, email or phone" input used by
 * login and forgot-password. Identifiers are LTR content (usernames, emails
 * and E.164 numbers never mirror), so the input is `dir="ltr"` with
 * `text-start` (AGENTS.md section 8).
 */
export function IdentifierField({
  name = 'identifier',
  label,
  hint,
  error,
  value,
  onChange,
  autoComplete = 'username',
  required = false,
  autoFocus = false,
  disabled = false,
}: IdentifierFieldProps) {
  return (
    <Field name={name} label={label} hint={hint} error={error} required={required}>
      {(props) => (
        <Input
          {...props}
          type="text"
          dir="ltr"
          className="text-start"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          disabled={disabled}
          autoFocus={autoFocus}
        />
      )}
    </Field>
  );
}
