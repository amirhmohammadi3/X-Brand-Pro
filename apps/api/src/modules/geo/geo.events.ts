/**
 * Geo domain events (B2.1). Emitted via EventEmitter2 so other modules
 * (cache invalidation, audit, future notifications) can react without the
 * geo service knowing about them.
 */
export const GEO_EVENTS = {
  cityDeactivated: 'geo.city.deactivated',
  cityCreated: 'geo.city.created',
  cityUpdated: 'geo.city.updated',
  cityDeleted: 'geo.city.deleted',
  cityReordered: 'geo.city.reordered',
} as const;
