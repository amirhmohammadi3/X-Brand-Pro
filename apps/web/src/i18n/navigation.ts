import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation primitives (next-intl). Use these instead of
 * `next/link`/`next/navigation` so URLs keep their locale prefix rules
 * (`fa` unprefixed, other locales prefixed).
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
