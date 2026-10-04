// page.evaluate callbacks run in the browser.
/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, SUPABASE_URL, test } from './fixtures';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const USER_ID = '0e2e0000-0000-4000-8000-0000000000c3';
const TENANT = '0e2e0000-0000-4000-8000-0000000000d0';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

function reply(route: Route, json: unknown) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ json, headers: CORS });
}

/** A stored, registered staff session (as supabase-js keeps it in localStorage). */
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
      email: 'bauhof@example.org',
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

// Three drops in Stelle, given out of route order.
const TASKS = [
  { id: 'task-mid', lat: 53.3882, bags: 2 },
  { id: 'task-south', lat: 53.3842, bags: 4 },
  { id: 'task-north', lat: 53.3922, bags: 1 },
].map((t) => ({
  id: t.id,
  report_id: `0e2e0000-0000-4000-8000-0000000${t.id.length}e${t.bags}00`,
  lng: 10.1105,
  lat: t.lat,
  accuracy_m: 6,
  bag_count: t.bags,
  estimated_kg: t.bags * 6,
  photo_path: null,
  category: 'mixed',
  created_at: '2026-10-05T07:30:00Z',
}));

async function routePickups(page: Page) {
  const state = { open: [...TASKS], collected: [] as string[] };
  await page.route(`${SUPABASE_URL}/rest/v1/memberships?*`, (route) =>
    reply(route, [
      { tenant_id: TENANT, role: 'municipality_staff', tenants: { name: 'Landkreis Harburg' } },
    ]),
  );
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/open_pickup_tasks*`, (route) =>
    reply(route, state.open),
  );
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/collect_pickup*`, (route) => {
    if (route.request().method() === 'POST') {
      const id = (route.request().postDataJSON() as { p_task_id: string }).p_task_id;
      state.collected.push(id);
      state.open = state.open.filter((t) => t.id !== id);
    }
    return reply(route, null);
  });
  return state;
}

test.use({
  geolocation: { longitude: 10.1105, latitude: 53.3962, accuracy: 10 },
  permissions: ['geolocation'],
});

test('staff: pickup route from my location, collect a stop; accessible (de + ar)', async ({
  page,
}) => {
  await signIn(page);
  const state = await routePickups(page);
  await page.goto('/app/profile');
  await page.getByRole('link', { name: 'Abholroute für Müllsäcke' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Abholung von Müllsäcken' }),
  ).toBeVisible();
  await expect(page.getByText(/^Stopps: 3 · Säcke: 7 · etwa 42 kg/)).toBeVisible();
  await expectNoA11yViolations(page);

  // Standing north of all stops: the route starts with the northern one.
  await page.getByRole('button', { name: 'Von meinem Standort starten' }).click();
  await expect(page.getByText('Die Route beginnt an Ihrem Standort.')).toBeVisible();
  const stops = page.locator('main ol > li');
  await expect(stops).toHaveCount(3);
  await expect(stops.first()).toContainText('Säcke: 1');
  await expect(stops.last()).toContainText('Säcke: 4');
  await expect(page.getByRole('link', { name: /Route öffnen/ })).toHaveAttribute(
    'href',
    /^https:\/\/routing\.openstreetmap\.de\/\?loc=53\.396200%2C10\.110500&loc=53\.392200/,
  );

  await page.getByRole('button', { name: 'Stopp 1 als abgeholt markieren' }).click();
  await expect(page.getByText('Stopp als abgeholt markiert.')).toBeVisible();
  await expect(page.getByText(/^Stopps: 2/)).toBeVisible();
  expect(state.collected).toEqual(['task-north']);

  await page.getByLabel('Sprache').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'جمع الأكياس' })).toBeVisible();
  await expectNoA11yViolations(page);
});
