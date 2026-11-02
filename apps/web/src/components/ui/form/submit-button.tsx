import { useTranslations } from 'next-intl';
import { Button, type ButtonProps } from '../button';

export interface SubmitButtonProps extends Omit<ButtonProps, 'type'> {
  /** Defaults to the localized "save" verb. */
  children?: React.ReactNode;
}

/**
 * `SubmitButton` (F1.4). A `Button` with `type="submit"` whose `loading`
 * state is meant to be tied to react-hook-form's `formState.isSubmitting`.
 * Callers pass `loading={formState.isSubmitting}`; this component just
 * guarantees the submit type and a sensible default label.
 */
export function SubmitButton({ children, ...rest }: SubmitButtonProps) {
  const t = useTranslations('common');
  return (
    <Button type="submit" {...rest}>
      {children ?? t('save')}
    </Button>
  );
}
