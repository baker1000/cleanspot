// Manual check (npm run check:tiles): loads the REAL OpenFreeMap style and tiles with 60 fake
// reports, and saves screenshots (German and Arabic) to e2e-manual/test-results/. Not part of
// `npm run test:e2e`, because it depends on an external service.
import { test } from '@playwright/test';
test('real OpenFreeMap style with clustered fake reports', async ({ page }) => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    id: `r${i}`,
    lng: 9.85 + (i % 10) * 0.02,
    lat: 53.35 + Math.floor(i / 10) * 0.015,
    status: ['reported', 'confirmed', 'in_progress'][i % 3],
    category: 'mixed',
    is_hazardous: i % 7 === 0,
    size: 'bag',
    confirmation_count: 0,
    is_claimed: false,
    reported_by_me: false,
    created_at: '2026-10-01T00:00:00Z',
  }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await page.route('https://supabase.e2e.invalid/**', (r) =>
    r.request().method() === 'OPTIONS'
      ? r.fulfill({ status: 204, headers: cors })
      : r.fulfill({ json: rows, headers: cors }),
  );
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url().slice(0, 100)}`));
  await page.goto('/app');
  await page.waitForTimeout(8000);
  await page.screenshot({ path: test.info().outputPath('real-tiles-de.png') });
  await page.evaluate(() => localStorage.setItem('cleanspot.lang', 'ar'));
  await page.reload();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: test.info().outputPath('real-tiles-ar.png') });
  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
});
