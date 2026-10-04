/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
