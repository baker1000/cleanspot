import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  use: { baseURL: 'http://127.0.0.1:4174', locale: 'de-DE', ...devices['Pixel 5'] },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    cwd: '..',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'https://supabase.e2e.invalid',
      VITE_SUPABASE_ANON_KEY: 'x',
      VITE_GEOCODER_PROVIDER: 'none',
    },
  },
});
