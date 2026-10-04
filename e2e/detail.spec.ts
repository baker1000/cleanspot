// page.evaluate callbacks run in the browser.
/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, SUPABASE_URL, test } from './fixtures';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const REPORT_ID = '0e2e0000-0000-4000-8000-00000000d001';
const USER_ID = '0e2e0000-0000-4000-8000-0000000000b2';
const PUBLIC_TENANT = '0e2e0000-0000-4000-8000-0000000000c0';
const SPOT = { lng: 10.1105, lat: 53.3842 };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
};

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

function reply(route: Route, json: unknown) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ json, headers: CORS });
}

interface State {
  status: 'confirmed' | 'in_progress' | 'cleared';
  calls: { fn: string; body: unknown }[];
  /** Pickup tasks the signed-in user reported (pickup_tasks, RLS: own). */
  pickups?: { id: string; bag_count: number; status: string; created_at: string }[];
}

/** A tiny real WebP, so the signed photo URL renders as an image. */
async function webpBytes(page: Page) {
  return Buffer.from(
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 30;
      c.getContext('2d')!.fillRect(0, 0, 40, 30);
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), 'image/webp'));
      return [...new Uint8Array(await b.arrayBuffer())];
    }),
  );
}

/** Fake PostgREST + Storage for one report (supabase-js request shapes). */
async function routeDetail(page: Page, state: State, { signedIn }: { signedIn: boolean }) {
  const report = () => ({
    id: REPORT_ID,
    tenant_id: PUBLIC_TENANT,
    ...SPOT,
    category: 'bulky',
    hazard_type: null,
    is_hazardous: false,
    size: 'pile',
    status: state.status,
    comment: 'Sofa und Schrank am Feldweg',
    is_published: true,
    confirmation_count: 2,
    estimated_kg: 40,
    is_claimed: state.status !== 'confirmed',
    claimed_by_me: signedIn && state.status !== 'confirmed',
    reported_by_me: false,
    created_at: '2026-10-01T10:00:00Z',
    cleared_at: state.status === 'cleared' ? '2026-10-04T12:00:00Z' : null,
  });
  const rest = (table: string, rows: () => unknown) =>
    page.route(`${SUPABASE_URL}/rest/v1/${table}?*`, (route) => reply(route, rows()));

  await rest('reports_public', () => [report()]);
  await rest('report_photos_public', () => [
    { id: 'ph1', kind: 'before', storage_path: `owner/ph1.webp`, taken_at: null },
  ]);
  await rest('report_events_public', () => [
    {
      id: 'e1',
      type: 'created',
      from_status: null,
      to_status: 'reported',
      created_at: '2026-10-01T10:00:00Z',
    },
    {
      id: 'e2',
      type: 'confirmed',
      from_status: null,
      to_status: null,
      created_at: '2026-10-02T10:00:00Z',
    },
  ]);
  await page.route(`${SUPABASE_URL}/rest/v1/tenants?*`, (route) => {
    const url = route.request().url();
    return reply(
      route,
      url.includes('kind=eq.public')
        ? [{ id: PUBLIC_TENANT }]
        : [
            {
              name: 'Landkreis Harburg',
              kind: 'municipality',
              settings: { cleanup_radius_m: 50, bag_drop_radius_m: 300, max_bags_per_drop: 30 },
            },
          ],
    );
  });
  await rest('report_photos', () => []);
  await rest('pickup_tasks', () => state.pickups ?? []);
  await rest('report_confirmations', () => []);
  await rest('memberships', () => [{ tenant_id: PUBLIC_TENANT, role: 'volunteer' }]);

  const image = await webpBytes(page);
  await page.route(`${SUPABASE_URL}/storage/v1/object/sign/report-photos`, (route) =>
    reply(
      route,
      (route.request().postDataJSON()?.paths ?? []).map((path: string) => ({
        path,
        signedURL: `/object/sign/report-photos/${path}?token=t`,
        error: null,
      })),
    ),
  );
  await page.route(`${SUPABASE_URL}/storage/v1/object/sign/report-photos/**`, (route) =>
    route.fulfill({ body: image, contentType: 'image/webp', headers: CORS }),
  );
  await page.route(`${SUPABASE_URL}/storage/v1/object/report-photos/**`, (route) =>
    route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : reply(route, { Key: 'x', Id: 'obj' }),
  );

  const rpc = (fn: string, result: () => unknown) =>
    page.route(`${SUPABASE_URL}/rest/v1/rpc/${fn}*`, (route) => {
      if (route.request().method() !== 'OPTIONS') {
        state.calls.push({ fn, body: route.request().postDataJSON() });
      }
      return reply(route, result());
    });
  await rpc('claim_report', () => {
    state.status = 'in_progress';
    return null;
  });
  await rpc('submit_cleanup', () => {
    state.status = 'cleared';
    return { photo_id: 'after-1', distance_m: 11.1 };
  });
  await rpc('report_bags', () => {
    const body = state.calls.at(-1)!.body as { p_bag_count: number };
    state.pickups = [
      {
        id: 'task-1',
        bag_count: body.p_bag_count,
        status: 'open',
        created_at: new Date().toISOString(),
      },
    ];
    return 'task-1';
  });
}

/** A stored, registered session, as supabase-js keeps it in localStorage. */
async function signIn(page: Page) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp: now + 3600 })}.sig`;
  const session = {
    access_token: token,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'helfer@example.org',
      is_anonymous: false,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  await page.addInitScript((value) => {
    localStorage.setItem('sb-supabase-auth-token', value);
  }, JSON.stringify(session));
}

test('visitor sees report, photo, route and history; no a11y violations', async ({ page }) => {
  const state: State = { status: 'confirmed', calls: [] };
  await routeDetail(page, state, { signedIn: false });
  await page.goto(`/app/reports/${REPORT_ID}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Sperrmüll' })).toBeVisible();
  await expect(page.getByText('Sofa und Schrank am Feldweg')).toBeVisible();
  const img = page.getByRole('img', { name: 'Foto 1' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(40);
  await expect(page.getByRole('link', { name: 'Route (OpenStreetMap)' })).toHaveAttribute(
    'href',
    /openstreetmap\.org\/directions/,
  );
  await expect(page.getByRole('link', { name: 'Zum Konto' })).toBeVisible();
  await expectNoA11yViolations(page);

  // Arabic: right-to-left layout, still accessible.
  await page.getByLabel('Sprache').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('link', { name: 'العودة إلى الخريطة' })).toBeVisible();
  await expectNoA11yViolations(page);
});

test.describe('volunteer', () => {
  test.use({
    geolocation: { longitude: SPOT.lng, latitude: SPOT.lat + 0.0001, accuracy: 6 },
    permissions: ['geolocation'],
  });

  test('claims the report and marks it cleared with an after-photo', async ({ page }) => {
    const state: State = { status: 'confirmed', calls: [] };
    await signIn(page);
    await routeDetail(page, state, { signedIn: true });
    await page.goto(`/app/reports/${REPORT_ID}`);

    await page.getByRole('button', { name: 'Ich räume das auf' }).click();
    await expect(
      page.getByText('Danke! Die Meldung ist jetzt als „In Arbeit“ markiert.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wieder abgeben' })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByLabel('Foto nach der Beseitigung aufnehmen').setInputFiles({
      name: 'after.webp',
      mimeType: 'image/webp',
      buffer: await webpBytes(page),
    });
    await expect(
      page.getByRole('img', { name: 'Vorschau des Fotos nach der Beseitigung' }),
    ).toBeVisible();
    await expect(page.getByText('Sie sind etwa 11 m entfernt.')).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Als beseitigt melden' }).click();

    await expect(page.getByText('Danke! Die Meldung ist als beseitigt markiert.')).toBeVisible();
    await expect(page.getByText(/^Beseitigt am/)).toBeVisible();
    expect(state.calls.map((c) => c.fn)).toEqual(['claim_report', 'submit_cleanup']);
    expect(state.calls[1]!.body).toMatchObject({
      p_report_id: REPORT_ID,
      p_photo_path: expect.stringMatching(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.webp$`)),
      p_lng: SPOT.lng,
      p_lat: SPOT.lat + 0.0001,
      p_accuracy_m: 6,
      p_taken_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });

    // Then: the bags left at the roadside, for the municipality to collect.
    await expect(page.getByRole('heading', { name: 'Säcke zur Abholung' })).toBeVisible();
    await page.getByLabel('Anzahl der Säcke').fill('3');
    await page.getByLabel('Foto der Säcke aufnehmen').setInputFiles({
      name: 'bags.webp',
      mimeType: 'image/webp',
      buffer: await webpBytes(page),
    });
    await expect(page.getByRole('img', { name: 'Vorschau des Fotos der Säcke' })).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole('button', { name: 'Säcke zur Abholung melden' }).click();
    await expect(
      page.getByText('Danke! Die Kommune sieht die Säcke jetzt in ihrer Abholliste.'),
    ).toBeVisible();
    await expect(page.getByText('Säcke: 3 – wird abgeholt')).toBeVisible();
    expect(state.calls.at(-1)).toMatchObject({
      fn: 'report_bags',
      body: {
        p_report_id: REPORT_ID,
        p_bag_count: 3,
        p_photo_path: expect.stringMatching(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.webp$`)),
      },
    });
  });
});
