/**
 * Query-key factory. One nested object per domain, added by the prompt that
 * owns the domain. Keys are hierarchical so `invalidateQueries({ queryKey:
 * qk.businesses.all() })` invalidates every list/detail variant.
 */
export const qk = {
  health: () => ['health'] as const,
};
