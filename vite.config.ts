/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // The app shows an "update available" notice (UpdatePrompt) instead of reloading by itself.
      registerType: 'prompt',
      injectRegister: false,
      injectManifest: {
        // All code chunks incl. the map (~1 MB) and the legal texts, so the app opens offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        id: '/app',
        name: 'CleanSpot – Müll melden und beseitigen',
        short_name: 'CleanSpot',
        description:
          'Illegale Müllablagerungen mit Foto und Standort melden, auf der Karte sehen und beseitigen.',
        lang: 'de',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#15803d',
        background_color: '#ffffff',
        categories: ['utilities', 'lifestyle'],
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Müll melden',
            short_name: 'Melden',
            url: '/app/report',
            icons: [{ src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      // The service worker only runs in builds (preview, production, E2E), never in `npm run dev`.
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: '127.0.0.1', port: 5173 },
  // MapLibre's worker is an ES module.
  worker: { format: 'es' },
  build: {
    // MapLibre (~280 kB gzip) is one lazy chunk that cannot be split further; the main chunk stays
    // around 110 kB gzip. Raise the warning limit only as far as that map chunk needs.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/tests/lite/**/*.test.ts',
      'supabase/functions/_shared/**/*.test.ts',
      'tests/static/**/*.test.ts',
    ],
    testTimeout: 20_000,
    css: false,
  },
});
