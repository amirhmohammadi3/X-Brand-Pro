'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { SuggestHit } from '@app/contracts';
import { useSuggest } from '@/lib/api/search';
import { buildLocaleHref, buildSuggestHitTarget } from '@/lib/search/links';

/**
 * The auto-suggest typeahead (F3.6) over `GET /search/suggest` (B3.3).
 *
 * Interaction: 250 ms debounce + ≥2 chars gate (the endpoint is rate-limited
 * 120/min/ip — keystroke bursts must not burn the bucket); full WAI-ARIA
 * combobox pattern (role=combobox + listbox + aria-activedescendant,
 * ↑/↓/Enter/Escape/Home/End); hits GROUP by kind with localized headers;
 * every hit navigates to the map-search page with its scope param
 * (lib/search/links — F3.5/F4.1 override per-kind targets there), and Enter
 * with a raw query lands on `/search?q=…` (F3.4's page).
 *
 * Deliberately NO in-string highlight: Persian ZWNJ half-spaces and
 * Arabic/Persian spelling variants make per-character ranges fragile, and
 * the server already ranks prefix matches first — a future prompt can add
 * it against the `score` field (DECISIONS F3.6).
 */

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

const GROUP_ORDER = ['business', 'category', 'neighborhood', 'city'] as const;
type GroupKind = (typeof GROUP_ORDER)[number];

export interface SearchBoxProps {
  /** Scope neighborhood/business suggestions to a city (B3.3 cityId). */
  cityId?: string;
  /** Input placeholder override (defaults to the i18n string). */
  placeholder?: string;
  /** Auto-focus the input on mount (hero/search pages). */
  autoFocus?: boolean;
  className?: string;
  /** Fires when the user submits a raw (non-hit) query — F3.4 listens too. */
  onSubmitRawQuery?: (q: string) => void;
}

export function SearchBox({
  cityId,
  placeholder,
  autoFocus = false,
  className,
  onSubmitRawQuery,
}: SearchBoxProps) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const suggest = useSuggest(
    { q: debouncedQ, cityId, limit: 8 },
    { enabled: debouncedQ.trim().length >= MIN_QUERY_LEN },
  );
  const hits: SuggestHit[] = suggest.data?.items ?? [];

  const grouped = useMemo(() => {
    const map = new Map<GroupKind, SuggestHit[]>();
    for (const hit of hits) {
      if (!GROUP_ORDER.includes(hit.kind as GroupKind)) continue;
      const list = map.get(hit.kind as GroupKind) ?? [];
      list.push(hit);
      map.set(hit.kind as GroupKind, list);
    }
    return GROUP_ORDER.filter((k) => map.has(k)).map((kind) => ({
      kind,
      items: map.get(kind)!,
    }));
  }, [hits]);

  // Flatten to an index-aligned list for keyboard navigation.
  const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [debouncedQ]);

  const closeList = () => setOpen(false);

  const navigateToHit = (hit: SuggestHit) => {
    const target = buildSuggestHitTarget(hit);
    if (!target) return;
    closeList();
    router.push(
      target.kind === 'route'
        ? buildLocaleHref(locale, target.path)
        : {
            pathname: target.path,
            query: target.query,
          },
    );
  };

  const submitRaw = () => {
    const q = text.trim();
    if (q.length === 0) return;
    closeList();
    onSubmitRawQuery?.(q);
    router.push({ pathname: '/search', query: { q } });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(flat.length > 0 ? 0 : -1);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Home') {
      if (open) {
        e.preventDefault();
        setActiveIndex(flat.length > 0 ? 0 : -1);
      }
    } else if (e.key === 'End') {
      if (open) {
        e.preventDefault();
        setActiveIndex(flat.length - 1);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        closeList();
        setActiveIndex(-1);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && flat[activeIndex]) {
        navigateToHit(flat[activeIndex]!);
      } else {
        submitRaw();
      }
    } else if (e.key === 'Tab') {
      closeList();
    }
  };

  const optionIdFor = (index: number) => `${listboxId}-opt-${index}`;
  const groupLabelFor = (kind: GroupKind) => t(`groups.${kind}`);

  const showList =
    open && (suggest.isFetching || hits.length > 0 || debouncedQ.trim().length >= MIN_QUERY_LEN);

  return (
    <div className={`relative ${className ?? ''}`} data-testid="search-box">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? optionIdFor(activeIndex) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-border-subtle bg-surface px-4 py-2 text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={placeholder ?? t('placeholder')}
        aria-label={t('label')}
        value={text}
        data-testid="search-input"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so option clicks (mousedown) fire before the list unmounts.
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
      />

      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('label')}
          data-testid="search-listbox"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-border-subtle bg-surface shadow-lg"
        >
          {suggest.isFetching && hits.length === 0 ? (
            <li aria-hidden className="px-4 py-2 text-sm text-muted" data-testid="search-loading">
              {t('loading')}
            </li>
          ) : hits.length === 0 ? (
            <li aria-hidden className="px-4 py-2 text-sm text-muted" data-testid="search-empty">
              {t('noResults')}
            </li>
          ) : (
            grouped.map((group) => (
              <li key={group.kind} role="presentation" className="contents">
                <span
                  aria-hidden
                  className="block bg-surface-alt px-4 py-1 text-xs font-semibold text-muted"
                  data-testid={`search-group-${group.kind}`}
                >
                  {groupLabelFor(group.kind)}
                </span>
                {group.items.map((hit) => {
                  const index = flat.indexOf(hit);
                  return (
                    <div
                      key={`${hit.kind}:${hit.id}`}
                      role="option"
                      id={optionIdFor(index)}
                      aria-selected={index === activeIndex}
                      tabIndex={-1}
                      data-testid={`search-option-${hit.kind}`}
                      className={`cursor-pointer px-4 py-2 ${index === activeIndex ? 'bg-surface-alt' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep input focus (blur closes with a delay)
                        navigateToHit(hit);
                      }}
                    >
                      <span className="block text-sm text-text">{hit.label}</span>
                      {hit.sublabel ? (
                        <span className="block text-xs text-muted">{hit.sublabel}</span>
                      ) : null}
                    </div>
                  );
                })}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
