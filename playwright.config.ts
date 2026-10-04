import { defineConfig, devices } from '@playwright/test';
import { GEOCODER_URL, STYLE_URL, SUPABASE_URL } from './e2e/fixtures';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    // German is the default UI language; tests that need another locale override this.
    locale: 'de-DE',
  },
  projects: [
    // Low-end Android phone is the primary target.
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Build against fake hosts that the tests answer (e2e/fixtures.ts). Process env wins over
    // any local .env file, so a developer's real backend is never used by E2E tests.
    env: {
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      VITE_MAP_STYLE_URL: STYLE_URL,
      VITE_GEOCODER_PROVIDER: 'nominatim',
      VITE_GEOCODER_URL: GEOCODER_URL,
      VITE_GEOCODER_COUNTRYCODES: '',
      VITE_DEMO_MODE: 'false',
    },
  },
});
