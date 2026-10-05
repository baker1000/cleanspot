// Which runtime cache a request goes to. Pure, so it can be tested without a service worker.

export type CacheName = 'map-style' | 'map-tiles' | 'stats';

export interface RouteEnv {
  mapStyleUrl: string;
  /** Null without backend configuration. */
  supabaseUrl: string | null;
}

/** Last path segment has a file extension (tiles .pbf/.mvt/.png, glyphs .pbf, sprites .json/.png). */
const HAS_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;

export function cacheFor(url: URL, env: RouteEnv): CacheName | null {
  let style: URL;
  try {
    style = new URL(env.mapStyleUrl);
  } catch {
    return null;
  }
  if (url.origin === style.origin) {
    // The style and TileJSON documents change when the provider publishes new data: network
    // first. Everything else (tiles, glyphs, sprites) is versioned or stable: cache first.
    if (url.href === style.href || !HAS_EXTENSION.test(url.pathname)) return 'map-style';
    return 'map-tiles';
  }
  if (env.supabaseUrl) {
    const stats = `${env.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/public_stats`;
    if (url.href === stats || url.href.startsWith(`${stats}?`)) return 'stats';
  }
  return null;
}

/** Viewed map areas kept for offline use; oldest-used tiles go first. */
export const MAP_TILE_MAX_ENTRIES = 3000;
export const MAP_TILE_MAX_AGE_S = 30 * 24 * 60 * 60;
