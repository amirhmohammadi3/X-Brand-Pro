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
    results: (params: unknown) => ['search', 'results', params] as const,
    map: (bbox?: string, zoom?: number, cityId?: string) =>
      ['search', 'map', bbox, zoom, cityId ?? 'all'] as const,
  },
  /**
   * Follows + feed (F5.2). `mine` covers BOTH follow lists (users +
   * businesses) in one row set, so a single key serves the account page and
   * every follow-button membership probe. `feed` is keyed by the active type
   * tab + page like any paginated list.
   */
  follows: {
    all: () => ['follows'] as const,
    /** `GET /follows/me` — the caller's followed users + businesses. */
    mine: () => ['follows', 'mine'] as const,
    /** `GET /feed` — one page of the home feed (optionally type-filtered). */
    feed: (type: string | null, page: number, pageSize: number) =>
      ['follows', 'feed', type ?? 'all', page, pageSize] as const,
  },
  /**
   * Notifications (F5.3). `unread` is a deliberately cheap probe (page size
   * 1) for the header bell; the inbox pages and the preferences matrix key
   * separately. Mark-read invalidates the whole subtree so the bell count,
   * the page and the read/unread styling move together.
   */
  notifications: {
    all: () => ['notifications'] as const,
    /** `GET /notifications/me/inbox` — one page (newest first, + unread total). */
    inbox: (page: number, pageSize: number) => ['notifications', 'inbox', page, pageSize] as const,
    /** The cheap unread probe the header bell polls. */
    unread: () => ['notifications', 'unread'] as const,
    /** `GET /notifications/me/preferences` — the merged channel matrix. */
    preferences: () => ['notifications', 'preferences'] as const,
    /** `GET /notifications/me/push/subscriptions` — the F5.4 device list. */
    pushDevices: () => ['notifications', 'push', 'devices'] as const,
  },
  /**
   * Messaging (F5.6). `inboxAll` is the prefix every inbox page shares so a
   * send / mark-read / delete invalidates the whole inbox in one pass (the
   * last-message preview + unread count depend on the same rows as the
   * thread). `threadAll` is the same idea per conversation; `blocksAll` for
   * the blocked-users list.
   */
  messaging: {
    inboxAll: () => ['messaging', 'inbox'] as const,
    inbox: (page: number, pageSize: number) => ['messaging', 'inbox', page, pageSize] as const,
    threadAll: (conversationId: string) => ['messaging', 'thread', conversationId] as const,
    thread: (conversationId: string, page: number, pageSize: number) =>
      ['messaging', 'thread', conversationId, page, pageSize] as const,
    blocksAll: () => ['messaging', 'blocks'] as const,
    blocks: () => ['messaging', 'blocks'] as const,
  },
  /**
   * Favorites (F5.1). The lists index key `['favorites','lists']` is a PREFIX
   * of every list-items page key `['favorites','lists',listId,'items',…]`, so
   * one `invalidateQueries({ queryKey: qk.favorites.lists() })` refreshes the
   * index AND every items page in a single pass — used by item moves/removes
   * where the source list is unknown to the caller.
   */
  favorites: {
    all: () => ['favorites'] as const,
    /** `GET /favorites/me` — the caller's lists (default first). */
    lists: () => ['favorites', 'lists'] as const,
    /** `GET /favorites/lists/:id/items` — one items page (newest first). */
    listItems: (listId: string, page: number, pageSize: number) =>
      ['favorites', 'lists', listId, 'items', page, pageSize] as const,
    /** Prefix of every items page of one list — used by add-item (target known). */
    listItemsAll: (listId: string) => ['favorites', 'lists', listId, 'items'] as const,
    /** `GET /favorites/me/check?businessId=` — the heart state, one probe. */
    status: (businessId: string) => ['favorites', 'status', businessId] as const,
  },
  /**
   * Bookings (F6.1/F6.2). `mine(scope,…)` keys keep the upcoming/past split;
   * the invalidate prefix `['bookings','mine']` (used by create/cancel)
   * covers every scope+status+page variant in one call. Availability is
   * keyed per (serviceId, date) so the slot grid refetches on every step.
   */
  bookings: {
    all: () => ['bookings'] as const,
    services: (businessId: string) => ['bookings', 'services', businessId] as const,
    availability: (serviceId: string, date: string) =>
      ['bookings', 'availability', serviceId, date] as const,
    mine: (
      scope?: 'all' | 'upcoming' | 'past',
      status?: string,
      page?: number,
      pageSize?: number,
    ) => ['bookings', 'mine', scope ?? 'all', status ?? 'none', page ?? 1, pageSize ?? 20] as const,
    calendarToken: () => ['bookings', 'calendar-token'] as const,
  },
};
