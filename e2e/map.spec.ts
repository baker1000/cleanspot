import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, GEOCODER_URL, MAP_CENTER, reportRow, test } from './fixtures';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

const canvas = (page: Page) => page.locator('[data-testid="map"] canvas');

test('MapLibre renders and a click on a marker opens the preview', async ({ page, backend }) => {
  backend.reports = [reportRow('r-center', { category: 'electronics', confirmation_count: 2 })];
  await page.goto('/app');
  await expect(canvas(page)).toBeVisible();
  await expect(page.getByText('1 Meldung in diesem Ausschnitt')).toBeVisible();
  // Map data attribution is always visible, not collapsed behind an icon.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(
    '© OpenStreetMap contributors',
  );
  await expect(page.locator('.maplibregl-ctrl-attrib')).not.toHaveClass(/maplibregl-compact/);
  // …and not covered by the count pill.
  const attribution = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!;
  const pill = (await page.getByText('1 Meldung in diesem Ausschnitt').boundingBox())!;
  expect(pill.y + pill.height).toBeLessThanOrEqual(attribution.y);

  // The report sits exactly at the map centre. Retry until the layer has been drawn.
  const sheetHeading = page.getByRole('heading', { level: 2, name: 'Elektroschrott' });
  await expect(async () => {
    const box = (await canvas(page).boundingBox())!;
    await canvas(page).click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(sheetHeading).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 15_000 });

  await expect(sheetHeading).toBeFocused();
  await expect(page.getByText('2 Bestätigungen')).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(sheetHeading).toBeHidden();
});

test('sends the viewport and filters to reports_in_bbox', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rpc/reports_in_bbox') && r.method() === 'POST') {
      calls.push(r.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto('/app');
  await expect(page.getByText('0 Meldungen in diesem Ausschnitt')).toBeVisible();
  const first = calls.at(-1)!;
  expect(first.p_min_lng as number).toBeLessThan(MAP_CENTER.lng);
  expect(first.p_max_lng as number).toBeGreaterThan(MAP_CENTER.lng);
  expect(first.p_statuses).toEqual(['reported', 'confirmed', 'in_progress']);
  expect(first.p_categories).toBeNull();

  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('checkbox', { name: 'Beseitigt' }).check();
  await expect.poll(() => calls.at(-1)!.p_statuses).toBeNull(); // all four = no filter
});

test('list view works with the keyboard and returns focus after closing', async ({
  page,
  backend,
}) => {
  backend.reports = [
    reportRow('near', { lng: MAP_CENTER.lng + 0.001, category: 'plastic', is_hazardous: true }),
    reportRow('far', { lng: MAP_CENTER.lng + 0.05, category: 'mixed' }),
  ];
  await page.goto('/app');
  await page.getByRole('button', { name: 'Liste' }).click();
  const list = page.getByRole('list', { name: 'Meldungen in diesem Ausschnitt' });
  const first = list.getByRole('button').first();
  await expect(first).toContainText('Kunststoff');
  await expect(first).toContainText('Gefährlich');
  await expectNoA11yViolations(page);

  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Kunststoff' })).toBeFocused();
  await expect(page.getByText('Gefährlicher Abfall: Bitte nicht berühren.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(first).toBeFocused();
});

test.describe('place search (Nominatim rules)', () => {
  const PLACE = {
    place_id: 7,
    display_name: 'Winsen (Luhe), Landkreis Harburg, Niedersachsen, Deutschland',
    lat: '53.357',
    lon: '10.212',
    boundingbox: ['53.33', '53.39', '10.15', '10.27'],
  };

  test('no request while typing; one policy-conform request per submit', async ({
    page,
    backend,
  }) => {
    backend.places = [PLACE];
    await page.goto('/app');
    const box = page.getByRole('searchbox', { name: 'Ort suchen' });
    await box.pressSequentially('Winsen Luhe', { delay: 50 });
    await page.waitForTimeout(1500);
    expect(backend.geocoderRequests).toHaveLength(0);

    await box.press('Enter');
    await expect(page.getByRole('button', { name: PLACE.display_name })).toBeVisible();
    expect(backend.geocoderRequests).toHaveLength(1);
    const url = backend.geocoderRequests[0]!.url;
    expect(url.origin).toBe(GEOCODER_URL);
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('q')).toBe('Winsen Luhe');
    expect(url.searchParams.get('accept-language')).toBe('de');
    await expect(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );

    await page.getByRole('button', { name: PLACE.display_name }).click();
    await expect(page.getByRole('button', { name: PLACE.display_name })).toBeHidden();
  });

  test('two quick searches are at least one second apart', async ({ page, backend }) => {
    backend.places = [PLACE];
    await page.goto('/app');
    const box = page.getByRole('searchbox', { name: 'Ort suchen' });
    await box.fill('Tostedt');
    await box.press('Enter');
    await expect(page.getByText('1 Treffer')).toBeVisible();
    await box.fill('Seevetal');
    await box.press('Enter');
    await expect.poll(() => backend.geocoderRequests.length).toBe(2);
    const [a, b] = backend.geocoderRequests;
    expect(b!.at - a!.at).toBeGreaterThanOrEqual(1000);
  });
});
