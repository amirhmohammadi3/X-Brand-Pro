'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useThemeMode } from '../../lib/theme/use-theme-mode';
import type { ThemeModePref } from '../../lib/theme/mode';
import { DropdownMenu, DropdownItem, DropdownLabel } from '../ui/dropdown-menu';
import { IconButton } from '../ui/icon-button';

/**
 * `ThemeModeToggle` (F1.7). Light / dark / system, each with an icon and
 * label. Uses {@link useThemeMode} which writes the `mode` cookie and updates
 * the `data-mode`/`data-mode-pref` attributes on `<html>`.
 *
 * To avoid a hydration mismatch the toggle renders a placeholder until mounted
 * (the server-rendered `data-mode-pref` already applied the correct mode via
 * the inline script in the root layout).
 */
const OPTIONS: ReadonlyArray<{ value: ThemeModePref; icon: typeof Sun }> = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

function readHtmlPref(): ThemeModePref {
  if (typeof document === 'undefined') return 'system';
  const pref = document.documentElement.getAttribute('data-mode-pref');
  return pref === 'light' || pref === 'dark' || pref === 'system' ? pref : 'system';
}

function readHtmlMode(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light';
}

export function ThemeModeToggle() {
  const t = useTranslations('theme.mode');
  const [mounted, setMounted] = useState(false);
  const initialPref = mounted ? readHtmlPref() : 'system';
  const initialResolved = mounted ? readHtmlMode() : 'light';
  const { mode, setMode } = useThemeMode({ pref: initialPref, resolved: initialResolved });

  useEffect(() => setMounted(true), []);

  const CurrentIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;

  if (!mounted) {
    return <IconButton icon={Monitor} aria-label={t('toggle')} disabled />;
  }

  return (
    <DropdownMenu trigger={<IconButton icon={CurrentIcon} aria-label={t('toggle')} />}>
      <DropdownLabel>{t('toggle')}</DropdownLabel>
      {OPTIONS.map(({ value, icon: Icon }) => {
        const active = mode === value;
        return (
          <DropdownItem
            key={value}
            onSelect={() => setMode(value)}
            aria-checked={active}
            role="menuitemradio"
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Icon size={16} />
                {t(value)}
              </span>
              {active ? <Check size={16} className="text-primary" /> : null}
            </span>
          </DropdownItem>
        );
      })}
    </DropdownMenu>
  );
}
