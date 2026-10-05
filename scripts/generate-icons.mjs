// Renders the PWA icons (PNG) from the SVG sources in public/icons with Playwright's Chromium.
// Run after changing an SVG: npm run icons. The PNGs are committed.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const DIR = join(import.meta.dirname, '..', 'public', 'icons');
const OUTPUTS = [
  { src: 'icon.svg', out: 'pwa-192.png', size: 192 },
  { src: 'icon.svg', out: 'pwa-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'maskable-512.png', size: 512 },
  // iOS draws its own rounded corners: use the full-bleed variant.
  { src: 'icon-maskable.svg', out: 'apple-touch-icon-180.png', size: 180 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { src, out, size } of OUTPUTS) {
    const svg = await readFile(join(DIR, src), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
        `width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.screenshot({ path: join(DIR, out), omitBackground: true });
    console.log(`${out} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
