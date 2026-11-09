'use client';

import { RecentSearches } from './recent-searches';
import { PopularQueries } from './popular-queries';
import { SearchBox } from './search-box';

/**
 * The home page's search block (F3.3) — the typeahead + personal + trending
 * layers stacked. Client component (all three children need client behavior:
 * debounced fetch, mutations, geolocation-free but still interactive).
 *
 * `onSubmitRawQuery` scrolls to the results (F3.4 owns the /search page; on
 * the home page Enter already navigates — the callback is kept for future
 * in-page flows).
 */
export function HomeSearch({ cityId }: { cityId?: string }) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4" data-testid="home-search">
      <SearchBox cityId={cityId} autoFocus className="w-full" />
      <RecentSearches limit={6} />
      <PopularQueries cityId={cityId} limit={8} />
    </div>
  );
}
