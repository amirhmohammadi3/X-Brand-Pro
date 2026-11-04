'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Check, Languages } from 'lucide-react';
import { useLanguages, useSwitchLocale } from '../../i18n/hooks';
import { DropdownMenu, DropdownItem, DropdownLabel } from '../ui/dropdown-menu';
import { IconButton } from '../ui/icon-button';

/**
 * `LanguageSwitcher` (F1.7). A dropdown of the active languages using their
 * native names (`nameNative`), with the current locale marked by a check.
 * Selecting one calls `useSwitchLocale` which writes the `locale` cookie and
 * navigates to the same path in the target locale.
 */
export function LanguageSwitcher() {
  const t = useTranslations('language.switcher');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { data: languages = [] } = useLanguages();
  const switchLocale = useSwitchLocale();

  return (
    <DropdownMenu trigger={<IconButton icon={Languages} aria-label={t('label')} />}>
      <DropdownLabel>{t('label')}</DropdownLabel>
      {languages.map((lang) => {
        const active = lang.code === locale;
        return (
          <DropdownItem
            key={lang.code}
            onSelect={() => switchLocale(lang.code)}
            aria-current={active ? 'true' : undefined}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span>{lang.nameNative}</span>
              {active ? <Check size={16} className="text-primary" /> : null}
            </span>
          </DropdownItem>
        );
      })}
      {languages.length === 0 ? <DropdownItem disabled>{tCommon('loading')}</DropdownItem> : null}
    </DropdownMenu>
  );
}
