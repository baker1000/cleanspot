// CleanSpot service worker (built by vite-plugin-pwa, injectManifest strategy).
//   - precaches the app shell and all code chunks, so the app opens offline
//   - caches map style, tiles, glyphs and sprites of viewed areas (offline map)
//   - keeps the last public statistics for the landing page
//   - Background Sync: sends the offline queue when the connection is back (background.ts)
// No other backend responses are cached: reports and photos are personal or change often.
/// <reference lib="webworker" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { createSupabaseSubmitApi, type SubmitClient } from '@/features/report/api';
import { runBackgroundSync, SYNC_MESSAGE, SYNC_TAG } from '@/features/report/outbox/background';
import { createIndexedDbStore } from '@/features/report/outbox/store';
import { createSharedAuthStorage } from '@/lib/authStorage';
import { parseEnv, parseMapEnv, type AppEnv } from '@/lib/env';
import { createIndexedDbKv } from '@/lib/idb';
import { cacheFor, MAP_TILE_MAX_AGE_S, MAP_TILE_MAX_ENTRIES } from './routes';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | PrecacheEntry)[];
};

/** Background Sync is not in TypeScript's lib yet. */
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}

const mapEnv = parseMapEnv(import.meta.env);
const backend: AppEnv | null = (() => {
  try {
    return parseEnv(import.meta.env);
  } catch {
    return null;
  }
})();

// --- App shell -------------------------------------------------------------------------------
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Every app route is client-side: serve index.html for all navigations.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// --- Runtime caches --------------------------------------------------------------------------
const routeEnv = { mapStyleUrl: mapEnv.mapStyleUrl, supabaseUrl: backend?.supabaseUrl ?? null };
const ok = new CacheableResponsePlugin({ statuses: [200] });

registerRoute(
  ({ url, request }) => request.method === 'GET' && cacheFor(url, routeEnv) === 'map-style',
  new NetworkFirst({
    cacheName: 'map-style',
    networkTimeoutSeconds: 4,
    plugins: [ok, new ExpirationPlugin({ maxEntries: 20 })],
  }),
);
registerRoute(
  ({ url, request }) => request.method === 'GET' && cacheFor(url, routeEnv) === 'map-tiles',
  new CacheFirst({
    cacheName: 'map-tiles',
    plugins: [
      ok,
      new ExpirationPlugin({
        maxEntries: MAP_TILE_MAX_ENTRIES,
        maxAgeSeconds: MAP_TILE_MAX_AGE_S,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);
registerRoute(
  ({ url, request }) => request.method === 'GET' && cacheFor(url, routeEnv) === 'stats',
  new NetworkFirst({
    cacheName: 'stats',
    networkTimeoutSeconds: 4,
    plugins: [ok, new ExpirationPlugin({ maxEntries: 2 })],
  }),
);

// --- Updates ---------------------------------------------------------------------------------
// The page asks before a new version takes over (a half-filled report form is never reloaded).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// --- Background Sync of the offline queue ----------------------------------------------------
let client: SupabaseClient | undefined;
const kv = createIndexedDbKv();
const store = createIndexedDbStore();

function getClient(env: AppEnv): SupabaseClient {
  client ??= createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      // The copy the page mirrors into IndexedDB; a refreshed session is written back there.
      storage: createSharedAuthStorage(kv, null),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

async function sendQueue() {
  const pages = await self.clients.matchAll({ type: 'window' });
  if (pages.length) {
    // An open page holds the live session and shows progress: let it send.
    for (const page of pages) page.postMessage({ type: SYNC_MESSAGE });
    return;
  }
  if (!backend) return;
  const supabase = getClient(backend);
  await runBackgroundSync({
    store,
    kv,
    deps: {
      api: createSupabaseSubmitApi(async () => supabase as unknown as SubmitClient),
      // Same as the page: the stored session (refreshed if expired), else a new anonymous one.
      async getUserId() {
        const { data } = await supabase.auth.getSession();
        if (data.session) return data.session.user.id;
        const { data: anon, error } = await supabase.auth.signInAnonymously();
        if (error || !anon.session) throw error ?? new Error('Anonymous sign-in failed');
        return anon.session.user.id;
      },
    },
  });
}

self.addEventListener('sync', (event) => {
  const sync = event as SyncEvent;
  if (sync.tag === SYNC_TAG) sync.waitUntil(sendQueue());
});
