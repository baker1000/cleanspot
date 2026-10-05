// PWA: manifest, service worker, offline start, map and statistics cache, Background Sync.
// These tests run with the service worker enabled. Requests it makes are only visible to
// context.route() (not page.route()), so the fake backend here is routed on the context.
// page.evaluate callbacks run in the browser.
/// <reference lib="dom" />
import type { BrowserContext, Page, Request, Route } from '@playwright/test';
import { BLANK_STYLE, expect, PUBLIC_STATS, STYLE_URL, SUPABASE_URL, test } from './fixtures';

test.use({
  serviceWorkers: 'allow',
  geolocation: { longitude: 10.1105, latitude: 53.3842, accuracy: 9 },
  permissions: ['geolocation'],
});

const ORIGIN = 'http://127.0.0.1:4173';
/** Same host as the test style, so the service worker treats it as a map tile. */
const TILES = new URL(STYLE_URL).origin;
const TILE_URL = `${TILES}/14/8650/5302.pbf`;
const USER_ID = '0e2e0000-0000-4000-8000-0000000000f1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
};

interface Backend {
  log: string[];
  reachable: boolean;
}

async function routeContext(context: BrowserContext): Promise<Backend> {
  const backend: Backend = { log: [], reachable: true };
  const handle = (name: string, fn: (request: Request) => unknown) => (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!backend.reachable) return route.abort('internetdisconnected');
    backend.log.push(name);
    return route.fulfill({ json: fn(request), headers: CORS });
  };
  const now = () => Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

  await context.route(`${SUPABASE_URL}/**`, (route) => route.abort('connectionrefused'));
  await context.route(
    `${TILES}/**`,
    handle('tile', () => ({ fake: 'tile' })),
  );
  await context.route(
    `${STYLE_URL}*`,
    handle('style', () => BLANK_STYLE),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/public_stats*`,
    handle('stats', () => PUBLIC_STATS),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/reports_in_bbox*`,
    handle('bbox', () => []),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/tenant_at_point*`,
    handle('tenant', () => []),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/find_nearby_open_reports*`,
    handle('nearby', () => []),
  );
  await context.route(
    `${SUPABASE_URL}/auth/v1/signup*`,
    handle('signup', () => ({
      access_token: `${b64({ alg: 'HS256' })}.${b64({ sub: USER_ID, exp: now() + 3600 })}.sig`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now() + 3600,
      refresh_token: 'e2e-refresh',
      user: {
        id: USER_ID,
        aud: 'authenticated',
        role: 'authenticated',
        is_anonymous: true,
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    })),
  );
  await context.route(
    `${SUPABASE_URL}/storage/v1/object/report-photos/**`,
    handle('upload', () => ({ Key: 'report-photos/x', Id: 'obj-1' })),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/submit_report*`,
    handle('submit_report', () => '0e2e0000-0000-4000-8000-00000000f001'),
  );
  await context.route(
    `${SUPABASE_URL}/rest/v1/rpc/add_report_photo*`,
    handle('add_report_photo', () => 'photo-1'),
  );
  return backend;
}

/** Installs the service worker; the next navigation is controlled by it. */
async function installServiceWorker(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

test('installable: manifest with icons, service worker registered', async ({ page }) => {
  await routeContext(page.context());
  await installServiceWorker(page);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({
    short_name: 'CleanSpot',
    start_url: '/app',
    display: 'standalone',
    theme_color: '#15803d',
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192' }),
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    ]),
  );
  for (const icon of manifest.icons as { src: string }[]) {
    const response = await page.request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()['content-type']).toBe('image/png');
  }
});

test('offline: the app starts, viewed map data and the statistics come from the cache', async ({
  page,
  context,
}) => {
  const backend = await routeContext(context);
  await installServiceWorker(page);

  // Controlled visits fill the runtime caches.
  await page.goto('/');
  await expect(page.getByText('1.234')).toBeVisible();
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: 'Karte' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect
    .poll(() => page.evaluate(async (url) => (await caches.match(url)) !== undefined, STYLE_URL))
    .toBe(true);
  // A tile the map loaded (the blank test style has no tile source, so fetch one directly).
  expect(await page.evaluate((u) => fetch(u).then((r) => r.status), TILE_URL)).toBe(200);

  backend.reachable = false;
  await context.setOffline(true);
  const before = backend.log.length;

  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  await expect(page.getByText(/Sie sind offline/)).toBeVisible();

  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: 'Karte' })).toBeVisible();
  // Style and the tile viewed before are answered from the cache; an unseen tile is not.
  const offlineFetch = (url: string) =>
    page.evaluate(
      (u) =>
        fetch(u).then(
          (r) => r.status,
          () => 'failed',
        ),
      url,
    );
  expect(await offlineFetch(STYLE_URL)).toBe(200);
  expect(await offlineFetch(TILE_URL)).toBe(200);
  expect(await offlineFetch(`${TILES}/14/1/2.pbf`)).toBe('failed');

  await page.goto('/');
  await expect(page.getByText('1.234')).toBeVisible();
  expect(backend.log.length).toBe(before);
});

test('Background Sync: the service worker sends the queue while no app page is open', async ({
  page,
  context,
}) => {
  const backend = await routeContext(context);
  await installServiceWorker(page);

  await page.goto('/app/report');
  const jpeg = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#7a5';
      ctx.fillRect(0, 0, 800, 600);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  await page
    .getByLabel('Foto auswählen')
    .setInputFiles({ name: 'IMG_0003.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Meinen Standort verwenden' }).click();
  await expect(page.getByText(/Genauigkeit etwa 9 m/)).toBeVisible();
  await page.getByRole('radio', { name: 'Sperrmüll' }).check();
  await page.getByRole('radio', { name: /Ein Haufen/ }).check();

  backend.reachable = false;
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Meldung absenden' }).click();
  await expect(page.getByRole('heading', { name: 'Auf diesem Gerät gespeichert' })).toBeFocused();

  // Close the app: from now on only the service worker can send.
  const blank = await context.newPage();
  await page.close();
  backend.reachable = true;
  await context.setOffline(false);
  backend.log.length = 0;

  // The browser fires the sync when it sees the connection; DevTools fires it deterministically.
  // A duplicate run sends nothing twice (outbox lock + idempotent submit).
  const cdp = await context.newCDPSession(blank);
  const registration = new Promise<string>((resolve) =>
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const reg = registrations.find((r) => r.scopeURL === `${ORIGIN}/` && !r.isDeleted);
      if (reg) resolve(reg.registrationId);
    }),
  );
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.dispatchSyncEvent', {
    origin: ORIGIN,
    registrationId: await registration,
    tag: 'cleanspot-outbox',
    lastChance: false,
  });

  await expect.poll(() => backend.log).toContain('add_report_photo');
  expect(
    backend.log.filter((c) => !['tenant', 'nearby', 'stats', 'style', 'bbox'].includes(c)),
  ).toEqual(['signup', 'upload', 'submit_report', 'add_report_photo']);

  // The next app start says what happened and uses the session the worker created.
  await blank.goto('/app/profile');
  await expect(blank.getByText('Gespeicherte Meldungen gesendet: 1')).toBeVisible();
  await expect(blank.getByText(/Wartende Meldungen/)).toHaveCount(0);
  expect(backend.log.filter((c) => c === 'signup')).toHaveLength(1);
});
