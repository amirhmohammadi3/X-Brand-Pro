'use client';

import { type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface BreadcrumbItem {
  label: ReactNode;
  href?: string;
  url?: string;
}

export interface BreadcrumbsProps {
  items: ReadonlyArray<BreadcrumbItem>;
  jsonLd?: boolean;
  className?: string;
}

/**
 * `Breadcrumbs` (F1.5). An ordered list of links with a logical-separator
 * chevron that mirrors in RTL. The last item is the current page
 * (`aria-current="page"`) and is not a link. When `jsonLd` is true, a
 * schema.org `BreadcrumbList` script is rendered for SEO.
 */
export function Breadcrumbs({ items, jsonLd = false, className }: BreadcrumbsProps) {
  const ld =
    jsonLd && items.length > 0
      ? {
          // JSON-LD vocabulary IRI: structured data, never a runtime request.
          '@context': 'https://schema.org', // external-ok
          '@type': 'BreadcrumbList',
          itemListElement: items.map((item, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: typeof item.label === 'string' ? item.label : undefined,
            item: item.url ?? item.href,
          })),
        }
      : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className={cn('text-sm', className)}>
        <ol className="flex flex-wrap items-center gap-1">
          {items.map((item, i) => {
            const last = i === items.length - 1;
            return (
              <li key={i} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronLeft
                    size={14}
                    className="text-text-subtle rtl:-scale-x-100"
                    aria-hidden="true"
                  />
                ) : null}
                {last || !item.href ? (
                  <span aria-current={last ? 'page' : undefined} className="text-text-subtle">
                    {item.label}
                  </span>
                ) : (
                  <a href={item.href} className="text-primary hover:underline">
                    {item.label}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {ld ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
        />
      ) : null}
    </>
  );
}
