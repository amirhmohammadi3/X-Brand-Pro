import type { ReactNode } from 'react';
import { Card, CardBody, Heading, Text } from '../ui';

export interface AuthCardProps {
  /** Page title — rendered as the page's single `h1` (DESIGN.md section 9). */
  title: ReactNode;
  /** One-line explanation under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Footer strip (e.g. "no account yet? register"). */
  footer?: ReactNode;
  className?: string;
}

/**
 * `AuthCard` (F1.8). The centered card every `(auth)` page renders inside —
 * title + subtitle + form body + optional footer, on a `Card` so the look
 * follows the active pack's `data-card` style.
 */
export function AuthCard({ title, subtitle, children, footer, className }: AuthCardProps) {
  return (
    <Card className={className}>
      <CardBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <Heading level="h1" className="text-2xl text-text">
            {title}
          </Heading>
          {subtitle ? (
            <Text as="p" size="sm" muted>
              {subtitle}
            </Text>
          ) : null}
        </div>
        {children}
        {footer ? (
          <div className="border-t border-border-subtle pt-3 text-sm text-text-subtle">
            {footer}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
