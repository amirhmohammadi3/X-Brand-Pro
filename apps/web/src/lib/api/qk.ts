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
};
