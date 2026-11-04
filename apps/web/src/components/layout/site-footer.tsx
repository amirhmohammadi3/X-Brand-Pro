'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { BRAND } from '../../lib/brand';
import { FOOTER_COLUMNS } from '../../lib/nav.config';
import { createFormatters } from '../../lib/format';
import { Container } from './container';
import { LanguageSwitcher } from './language-switcher';
import { ThemeModeToggle } from './theme-mode-toggle';

/**
 * `SiteFooter` (F1.7). Brand + tagline, link columns from config, a repeat
 * of the language switcher (useful on mobile where the header switcher is
 * less reachable), and a copyright line whose year is formatted in the
 * active calendar (`fa` → Jalali year).
 */
export function SiteFooter() {
  const tFooter = useTranslations('footer');
  const tBrand = useTranslations('brand');
  const tNav = useTranslations('nav');
  const locale = useLocale();
  const { formatDate } = createFormatters(locale);

  // Year from the Gregorian date, displayed in the active calendar.
  const now = new Date();
  const year = formatDate(now, 'long').split(' ').pop() ?? String(now.getFullYear());

  return (
    <footer className="mt-auto border-t border-border-subtle bg-surface">
      <Container className="py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 space-y-2 sm:col-span-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-on-primary">
                {BRAND.mark}
              </span>
              <span className="text-base font-semibold text-text">{tBrand('name')}</span>
            </div>
            <p className="text-sm text-text-subtle">{tBrand('tagline')}</p>
            <div className="flex items-center gap-1 pt-2 md:hidden">
              <LanguageSwitcher />
              <ThemeModeToggle />
            </div>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.key} className="space-y-2">
              <h2 className="text-sm font-semibold text-text">
                {tFooter(col.titleKey.replace('footer.', ''))}
              </h2>
              <ul className="space-y-1">
                {col.links.map((link) => (
                  <li key={link.key}>
                    <Link href={link.href} className="text-sm text-text-subtle hover:text-text">
                      {/* `labelKey` may be under `nav.*` or `footer.*`. */}
                      {link.labelKey.startsWith('footer.')
                        ? tFooter(link.labelKey.replace('footer.', ''))
                        : tNav(link.labelKey.replace('nav.', ''))}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-border-subtle pt-4 text-xs text-text-subtle">
          {tFooter('copyright', { year, brand: tBrand('name') })}
        </div>
      </Container>
    </footer>
  );
}
