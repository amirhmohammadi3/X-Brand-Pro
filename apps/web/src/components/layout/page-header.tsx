import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { ChevronLeft } from 'lucide-react';
import { Container } from './container';
import { cn } from '../../lib/cn';

/**
 * `PageHeader` (F1.7). Title + optional description, actions slot and
 * breadcrumbs for the top of a page. RTL-aware: the breadcrumb chevron
 * flips automatically because we use a logical icon layout.
 */
export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReadonlyArray<Breadcrumb>;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('border-b border-border-subtle pb-6 pt-4', className)}>
      <Container>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-text-subtle">
              {breadcrumbs.map((crumb, i) => {
                const last = i === breadcrumbs.length - 1;
                return (
                  <li key={i} className="flex items-center gap-1">
                    {crumb.href && !last ? (
                      <Link href={crumb.href} className="hover:text-text">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={last ? 'page' : undefined}
                        className={last ? 'text-text' : ''}
                      >
                        {crumb.label}
                      </span>
                    )}
                    {!last ? (
                      <ChevronLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-text sm:text-3xl">{title}</h1>
            {description ? (
              <p className="max-w-prose text-sm text-text-subtle sm:text-base">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </Container>
    </header>
  );
}
