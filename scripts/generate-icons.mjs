// Renders every app icon and splash image from one drawing (a white map pin with a check mark on
// CleanSpot green) with Playwright's Chromium: PWA icons, Android launcher icons (legacy, round,
// adaptive foreground) and iOS app icon + splash. Run after changing the drawing: npm run icons.
// The generated files are committed.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..');
const GREEN = '#15803d';
const PIN = `
  <path d="M256 440S120 306 120 214a136 136 0 0 1 272 0c0 92-136 226-136 226Z" fill="#fff"/>
  <path d="M196 214l40 40 82-86" fill="none" stroke="${GREEN}" stroke-width="32"
        stroke-linecap="round" stroke-linejoin="round"/>`;
const pin = (scale) =>
  `<g transform="translate(256 262) scale(${scale}) translate(-256 -262)">${PIN}</g>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

const VARIANTS = {
  // Rounded square: browsers, favicon, legacy Android launchers.
  icon: svg(`<rect width="512" height="512" rx="112" fill="${GREEN}"/>${pin(1)}`),
  // Full bleed with the pin inside the safe zone: PWA maskable, iOS (the system rounds it).
  maskable: svg(`<rect width="512" height="512" fill="${GREEN}"/>${pin(0.7)}`),
  round: svg(`<circle cx="256" cy="256" r="256" fill="${GREEN}"/>${pin(0.8)}`),
  // Android adaptive icon foreground (background is a colour): pin within the 66/108 safe zone.
  foreground: svg(pin(0.62)),
  // Splash screens: a small pin on green.
  splash: svg(`<rect width="512" height="512" fill="${GREEN}"/>${pin(0.22)}`),
};

const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const IOS_ASSETS = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');

const outputs = [
  { variant: 'icon', file: 'public/icons/pwa-192.png', size: 192 },
  { variant: 'icon', file: 'public/icons/pwa-512.png', size: 512 },
  { variant: 'maskable', file: 'public/icons/maskable-512.png', size: 512 },
  { variant: 'maskable', file: 'public/icons/apple-touch-icon-180.png', size: 180 },
  ...Object.entries(DENSITIES).flatMap(([density, f]) => [
    {
      variant: 'icon',
      file: join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher.png'),
      size: 48 * f,
    },
    {
      variant: 'round',
      file: join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher_round.png'),
      size: 48 * f,
    },
    {
      variant: 'foreground',
      file: join(ANDROID_RES, `mipmap-${density}`, 'ic_launcher_foreground.png'),
      size: 108 * f,
    },
  ]),
  {
    variant: 'maskable',
    file: join(IOS_ASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'),
    size: 1024,
  },
  ...['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((name) => ({
    variant: 'splash',
    file: join(IOS_ASSETS, 'Splash.imageset', name),
    size: 2732,
  })),
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, source] of Object.entries({
    icon: VARIANTS.icon,
    'icon-maskable': VARIANTS.maskable,
  })) {
    await writeFile(join(ROOT, 'public', 'icons', `${name}.svg`), `${source}\n`);
  }
  for (const { variant, file, size } of outputs) {
    const path = file.startsWith(ROOT) ? file : join(ROOT, file);
    await mkdir(dirname(path), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    const data = Buffer.from(VARIANTS[variant]).toString('base64');
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<img src="data:image/svg+xml;base64,${data}" width="${size}" height="${size}" ` +
        `style="display:block"></body></html>`,
    );
    await page.screenshot({ path, omitBackground: true });
    console.log(`${path.slice(ROOT.length + 1)} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
