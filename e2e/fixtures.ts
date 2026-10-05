// Shared E2E setup: no test talks to the internet. The build for E2E (playwright.config.ts) points
// the map style, geocoder and Supabase at *.e2e.invalid hosts, which are answered here.
import { test as base, expect, type Page, type Request, type Route } from '@playwright/test';

export const STYLE_URL = 'https://tiles.e2e.invalid/style.json';
export const GEOCODER_URL = 'https://nominatim.e2e.invalid';
export const SUPABASE_URL = 'https://supabase.e2e.invalid';

/** Same as DEFAULT_VIEW in MapPage: the map opens centred here. */
export const MAP_CENTER = { lng: 9.95, lat: 53.4 };

export const BLANK_STYLE = {
  version: 8,
  // An empty source that carries attribution, like the real OpenFreeMap style does.
  sources: {
    osm: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e9efe9' } },
    // MapLibre only shows attribution of sources that a layer uses.
    { id: 'osm', type: 'circle', source: 'osm' },
  ],
};

export interface ReportRow {
  id: string;
  lng: number;
  lat: number;
  status: string;
  category: string;
  is_hazardous: boolean;
  size: string;
  confirmation_count: number;
  is_claimed: boolean;
  reported_by_me: boolean;
  created_at: string;
}

export function reportRow(id: string, overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id,
    ...MAP_CENTER,
    status: 'reported',
    category: 'bulky',
    is_hazardous: false,
    size: 'pile',
    confirmation_count: 0,
    is_claimed: false,
    reported_by_me: false,
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

interface Backend {
  /** Rows returned by reports_in_bbox. */
  reports: ReportRow[];
  /** Results returned by the geocoder search. */
  places: unknown[];
  geocoderRequests: { url: URL; at: number }[];
}

export const PUBLIC_STATS = {
  reports: 1234,
  open: 210,
  cleared: 1024,
  cleared_last_30_days: 87,
  kg_cleared: 18450,
  municipalities: 2,
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/** Answers like a CORS-enabled server, including preflight requests. */
function reply(route: Route, json: unknown) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ json, headers: CORS });
}

async function routeBackend(page: Page, backend: Backend) {
  // Anything else on the fake backend (e.g. auth) fails like an offline server would.
  // Registered first: Playwright tries the most recently added route first.
  await page.route(`${SUPABASE_URL}/**`, (route) => route.abort('connectionrefused'));
  await page.route(`${STYLE_URL}*`, (route) => reply(route, BLANK_STYLE));
  await page.route(`${GEOCODER_URL}/**`, (route, request: Request) => {
    if (request.method() === 'GET') {
      backend.geocoderRequests.push({ url: new URL(request.url()), at: Date.now() });
    }
    return reply(route, backend.places);
  });
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/public_stats*`, (route) =>
    reply(route, PUBLIC_STATS),
  );
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/reports_in_bbox*`, (route) =>
    reply(route, backend.reports),
  );
}

export const test = base.extend<{ backend: Backend }>({
  backend: [
    async ({ page }, use) => {
      const backend: Backend = { reports: [], places: [], geocoderRequests: [] };
      await routeBackend(page, backend);
      await use(backend);
    },
    { auto: true },
  ],
});

export { expect };
