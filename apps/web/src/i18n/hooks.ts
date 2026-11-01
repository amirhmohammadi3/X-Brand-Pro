'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { languageListResponseSchema } from '@app/contracts';
import { apiFetch } from '../lib/api/client';
import { qk } from '../lib/api/qk';
import { LOCALE_COOKIE, localeDirection } from './languages';
import { usePathname, useRouter } from './navigation';

/**
 * Client-side language data (F1.1). The server renders `<html lang dir>`
 * from the same endpoint; these hooks exist for client components that need
 * the list (for example the switcher header built in F1.7).
 */

export function useLanguages() {
  return useQuery({
    queryKey: qk.languages(),
    queryFn: () => apiFetch('/i18n/languages', languageListResponseSchema),
    staleTime: 60_000,
    select: (result) => result.data.items,
  });
}

/**
 * Navigates to the SAME path in the target locale and persists the choice in
 * the `locale` cookie (1 year). No switcher UI here — F1.7 builds the header.
 */
export function useSwitchLocale(): (targetLocale: string) => void {
  const pathname = usePathname();
  const router = useRouter();
  return useCallback(
    (targetLocale: string) => {
      // Not httpOnly by design: the switcher writes it client-side; the
      // proxy reads it for the initial locale (see routing.ts).
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(targetLocale)}; path=/; max-age=31536000; samesite=lax`;
      // `routing.locales` is the build-safe pair, so the generated router
      // types narrow `locale` to them — the runtime accepts any ACTIVE
      // locale (the proxy rebuilds from the dynamic list).
      router.replace(pathname, { locale: targetLocale as 'fa' | 'en' });
    },
    [pathname, router],
  );
}

/** Direction for a locale, falling back to the record map (client-safe). */
export function useLocaleDirection(): (code: string) => 'rtl' | 'ltr' {
  const { data } = useLanguages();
  return useCallback((code: string) => localeDirection(data ?? [], code), [data]);
}
