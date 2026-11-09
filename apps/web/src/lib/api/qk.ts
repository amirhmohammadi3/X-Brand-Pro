/**
 * Query-key factory. One nested object per domain, added by the prompt that
 * owns the domain. Keys are hierarchical so `invalidateQueries({ queryKey:
 * qk.businesses.all() })` invalidates every list/detail variant.
 */
export const qk = {
  health: () => ['health'] as const,
  /** Active language list (`GET /i18n/languages`), 60 s fresh (F1.1). */
  languages: () => ['i18n', 'languages'] as const,
  /** Current user (`GET /auth/me`), kept fresh by the auth provider (F1.7). */
  auth: {
    me: () => ['auth', 'me'] as const,
    /** Active sessions of the current user (`GET /auth/sessions`, F1.9). */
    sessions: () => ['auth', 'sessions'] as const,
    /** Linked OAuth accounts (`GET /auth/oauth/accounts`, F1.9). */
    oauth: () => ['auth', 'oauth'] as const,
  },
  /** Public settings blob (`GET /settings/public`), e.g. OAuth flags (F1.8). */
  settings: {
    public: () => ['settings', 'public'] as const,
  },
  /** Admin catalog lists (F2.2). Hierarchical so one invalidation refreshes
   *  every view of a domain. */
  admin: {
    catalog: {
      cities: () => ['admin', 'catalog', 'cities'] as const,
      neighborhoods: (cityId: string) => ['admin', 'catalog', 'neighborhoods', cityId] as const,
      categories: () => ['admin', 'catalog', 'categories'] as const,
      amenities: () => ['admin', 'catalog', 'amenities'] as const,
      categoryAmenities: (categoryId: string) =>
        ['admin', 'catalog', 'category-amenities', categoryId] as const,
    },
    /** Admin i18n (F2.3): language list + per-locale translation pages. */
    i18n: {
      languages: () => ['admin', 'i18n', 'languages'] as const,
      translationsAll: () => ['admin', 'i18n', 'translations'] as const,
      translations: (locale: string, filter: unknown) =>
        ['admin', 'i18n', 'translations', locale, filter] as const,
    },
    /** Admin theme switch + settings registry (F2.4). */
    theme: {
      packs: () => ['admin', 'theme', 'packs'] as const,
    },
    settings: {
      all: () => ['admin', 'settings', 'all'] as const,
    },
    /** Admin users registry (F2.5). */
    users: {
      all: () => ['admin', 'users'] as const,
      list: (filter: unknown) => ['admin', 'users', 'list', filter] as const,
      detail: (id: string) => ['admin', 'users', 'detail', id] as const,
    },
  },
  /** Public search surfaces (F3.6): suggest typeahead, per-user history,
   *  popular queries. `suggest` is keyed by the exact typed prefix so every
   *  keystroke has its own cache entry (B3.3's server cache dedupes the rest). */
  search: {
    suggest: (q: string, cityId?: string, limit: number = 8) =>
      ['search', 'suggest', q, cityId ?? 'all', limit] as const,
    historyAll: () => ['search', 'history'] as const,
    history: (limit: number = 10) => ['search', 'history', limit] as const,
    popular: (cityId?: string, limit: number = 10) =>
      ['search', 'popular', cityId ?? 'all', limit] as const,
  },
};
