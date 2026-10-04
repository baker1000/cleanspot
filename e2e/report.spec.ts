// page.evaluate callbacks run in the browser.
/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright';
import type { Page, Request, Route } from '@playwright/test';
import { expect, SUPABASE_URL, test } from './fixtures';

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const USER_ID = '0e2e0000-0000-4000-8000-0000000000a1';
const REPORT_ID = '0e2e0000-0000-4000-8000-00000000b001';
const GPS = { longitude: 10.1105, latitude: 53.3842, accuracy: 9 };
const SECRET = 'GPS-SECRET-53.3842N-10.1105E';

test.use({ geolocation: GPS, permissions: ['geolocation'] });

async function expectNoA11yViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
};

/** Unsigned JWT-shaped token; the fake backend never checks it. */
function fakeJwt() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', is_anonymous: true, exp: now + 3600 })}.sig`;
}

interface Calls {
  log: string[];
  bodies: Record<string, unknown>;
  upload: { path: string; body: Buffer } | null;
}

/** Fake Supabase: anonymous sign-up, storage upload, and the report RPCs. */
async function routeSupabase(page: Page): Promise<Calls> {
  const calls: Calls = { log: [], bodies: {}, upload: null };
  const handle = (fn: (request: Request) => unknown) => (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ json: fn(request), headers: CORS });
  };

  await page.route(
    `${SUPABASE_URL}/auth/v1/signup*`,
    handle(() => {
      calls.log.push('signup');
      return {
        access_token: fakeJwt(),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
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
      };
    }),
  );
  await page.route(
    `${SUPABASE_URL}/storage/v1/object/report-photos/**`,
    handle((request) => {
      const path = decodeURIComponent(
        new URL(request.url()).pathname.replace('/storage/v1/object/report-photos/', ''),
      );
      calls.log.push('upload');
      calls.upload = { path, body: request.postDataBuffer()! };
      return { Key: `report-photos/${path}`, Id: 'obj-1' };
    }),
  );
  const rpc = (name: string, result: unknown) =>
    page.route(
      `${SUPABASE_URL}/rest/v1/rpc/${name}*`,
      handle((request) => {
        calls.log.push(name);
        calls.bodies[name] = request.postDataJSON();
        return result;
      }),
    );
  await rpc('tenant_at_point', [
    { tenant_id: 't1', kind: 'public', name: 'CleanSpot Community', bulky_waste_url: null },
  ]);
  await rpc('find_nearby_open_reports', []);
  await rpc('submit_report', REPORT_ID);
  await rpc('add_report_photo', 'photo-1');
  return calls;
}

/**
 * A real 2000×1500 JPEG from the browser's encoder, with an EXIF block spliced in: orientation 6
 * ("rotate 90°", as phones write for portrait shots) and a fake GPS string.
 */
async function jpegWithExif(page: Page): Promise<Buffer> {
  const jpeg = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000;
      canvas.height = 1500;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#7a5';
      ctx.fillRect(0, 0, 2000, 1500);
      ctx.fillStyle = '#333';
      ctx.fillRect(200, 200, 600, 400);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  const tiff = Buffer.concat([
    Buffer.from('MM\0*\0\0\0\x08', 'latin1'), // big-endian TIFF header, IFD at offset 8
    Buffer.from([0x00, 0x01]), // 1 entry
    Buffer.from([0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00]), // Orientation = 6
    Buffer.from([0, 0, 0, 0]), // no next IFD
    Buffer.from(SECRET, 'latin1'),
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]),
    payload,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** The WebP file inside the multipart upload body. */
function extractWebp(body: Buffer): Buffer {
  const start = body.indexOf('RIFF');
  expect(start).toBeGreaterThanOrEqual(0);
  return body.subarray(start, start + 8 + body.readUInt32LE(start + 4));
}

test('report with photo: EXIF removed, orientation applied, anonymous submit', async ({ page }) => {
  const calls = await routeSupabase(page);
  await page.goto('/app/report');
  await expect(page.getByRole('heading', { level: 1, name: 'Müll melden' })).toBeVisible();
  await expectNoA11yViolations(page);

  const original = await jpegWithExif(page);
  expect(original.includes(SECRET)).toBe(true); // control: the test file really carries it
  await page
    .getByLabel('Foto auswählen')
    .setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.getByRole('img', { name: 'Foto 1' })).toBeVisible();

  await page.getByRole('button', { name: 'Meinen Standort verwenden' }).click();
  await expect(page.getByText(/Genauigkeit etwa 9 m/)).toBeVisible();
  await page.getByRole('radio', { name: 'Gefährlicher Abfall' }).check();
  await expect(page.getByText(/außerhalb der teilnehmenden Kommunen/)).toBeVisible();
  await page.getByRole('radio', { name: 'Batterien oder Akkus' }).check();
  await page.getByRole('radio', { name: /Ein Beutel/ }).check();
  await expectNoA11yViolations(page);
  await page.getByRole('button', { name: 'Meldung absenden' }).click();

  await expect(page.getByRole('heading', { name: 'Vielen Dank!' })).toBeFocused();
  expect(
    calls.log.filter((c) => !['tenant_at_point', 'find_nearby_open_reports'].includes(c)),
  ).toEqual(['signup', 'upload', 'submit_report', 'add_report_photo']);

  // The upload went into the user's own folder, as WebP without any metadata.
  expect(calls.upload!.path).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]{36}\\.webp$`));
  const webp = extractWebp(calls.upload!.body);
  expect(webp.subarray(8, 12).toString('latin1')).toBe('WEBP');
  expect(calls.upload!.body.includes(SECRET)).toBe(false);
  expect(calls.upload!.body.includes('Exif')).toBe(false);
  expect(webp.includes('EXIF')).toBe(false);
  expect(webp.includes('XMP ')).toBe(false);
  // Rotated upright (portrait) and scaled to a 1600 px long edge.
  const size = await page.evaluate(
    async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
      );
      return [bitmap.width, bitmap.height];
    },
    [...webp],
  );
  expect(size).toEqual([1200, 1600]);

  expect(calls.bodies.submit_report).toMatchObject({
    p_lng: GPS.longitude,
    p_lat: GPS.latitude,
    p_accuracy_m: GPS.accuracy,
    p_category: 'hazardous',
    p_hazard_type: 'batteries',
    p_size: 'bag',
    p_comment: null,
  });
  expect(calls.bodies.add_report_photo).toEqual({
    p_report_id: REPORT_ID,
    p_path: calls.upload!.path,
  });
});

test('missing fields: error summary is announced, focused and accessible', async ({ page }) => {
  await routeSupabase(page);
  await page.goto('/app/report');
  await page.getByRole('button', { name: 'Meldung absenden' }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Bitte ergänzen Sie:' });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('link')).toHaveCount(4);
  await expectNoA11yViolations(page);
  await summary.getByRole('link', { name: 'die Menge' }).click();
  await expect(page.getByRole('group', { name: 'Menge' })).toBeFocused();
});
