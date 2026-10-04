// page.evaluate callbacks run in the browser.
/// <reference lib="dom" />
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, SUPABASE_URL, test } from './fixtures';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const USER_ID = '0e2e0000-0000-4000-8000-0000000000c9';
const PUBLIC_TENANT = '0e2e0000-0000-4000-8000-0000000000d9';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

async function expectNoA11yViolations(page: Page) {
  // Colour transitions (e.g. a button becoming enabled) would be measured half-way.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

function reply(route: Route, json: unknown, status = 200) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  return route.fulfill({ status, json, headers: CORS });
}

/** A stored, registered volunteer session (as supabase-js keeps it in localStorage). */
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
      email: 'freiwillig@example.org',
      is_anonymous: false,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  await page.addInitScript((value) => {
    // Only on the first load: after deleting, a reload must find no session.
    if (!sessionStorage.getItem('e2e-signed-in')) {
      sessionStorage.setItem('e2e-signed-in', '1');
      localStorage.setItem('sb-supabase-auth-token', value);
    }
  }, JSON.stringify(session));
}

async function routeProfile(page: Page) {
  const calls: string[] = [];
  let member = true;
  await page.route(`${SUPABASE_URL}/rest/v1/memberships?*`, (route) =>
    reply(
      route,
      member
        ? [
            {
              tenant_id: PUBLIC_TENANT,
              role: 'volunteer',
              tenants: { name: 'CleanSpot Community' },
            },
          ]
        : [],
    ),
  );
  const rpc = (fn: string, result: unknown) =>
    page.route(`${SUPABASE_URL}/rest/v1/rpc/${fn}*`, (route) => {
      if (route.request().method() === 'POST') calls.push(fn);
      if (fn === 'leave_volunteer_role') member = false;
      return reply(route, result);
    });
  await rpc('export_my_data', {
    format: 'cleanspot-export-v1',
    account: { id: USER_ID, email: 'freiwillig@example.org' },
    reports: [],
    photos: [],
  });
  await rpc('leave_volunteer_role', 1);
  await rpc('delete_my_photos', []);
  await rpc('delete_my_account', null);
  await page.route(`${SUPABASE_URL}/auth/v1/logout*`, (route) => {
    calls.push('logout');
    return route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: CORS })
      : route.fulfill({ status: 204, headers: CORS });
  });
  return calls;
}

test('profile: export, leave volunteering, delete account', async ({ page }) => {
  await signIn(page);
  const calls = await routeProfile(page);
  await page.goto('/app/profile');

  // Export → a JSON file download.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Meine Daten herunterladen' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^cleanspot-data-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported).toMatchObject({ format: 'cleanspot-export-v1', account: { id: USER_ID } });
  await expect(page.getByText('Die Datei wurde heruntergeladen.')).toBeVisible();

  // Leave the volunteer role.
  await page.getByRole('button', { name: 'Freiwillige Mithilfe beenden' }).click();
  await page.getByRole('button', { name: 'Ja, beenden' }).click();
  await expect(page.getByText(/1 übernommene Meldung wurde wieder freigegeben/)).toBeVisible();

  await expectNoA11yViolations(page);

  // Delete the account.
  await page.getByRole('button', { name: 'Konto löschen …' }).click();
  await page.getByLabel(/nicht rückgängig gemacht werden kann/).check();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Konto endgültig löschen' }).click();
  await expect(page.getByText('Ihr Konto und Ihre Daten wurden gelöscht.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Anmelden' })).toBeVisible();
  expect(calls).toEqual([
    'export_my_data',
    'leave_volunteer_role',
    'delete_my_photos',
    'delete_my_account',
    'logout',
  ]);

  // The session is gone from the device too.
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: 'Anmelden' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sb-supabase-auth-token'))).toBeNull();
});

test('legal pages: linked from the landing page, template notice, accessible (de + ar)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Datenschutz' }).click();
  await expect(page).toHaveURL(/\/datenschutz$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('juristisch geprüft');
  await expectNoA11yViolations(page);

  await page.getByRole('link', { name: 'Nutzungsbedingungen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nutzungsbedingungen' })).toBeVisible();

  await page.getByLabel('Sprache').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Use' })).toBeVisible();
  await expect(page.getByText(/متوفر بالألمانية والإنجليزية فقط/)).toBeVisible();
  await expectNoA11yViolations(page);
});
