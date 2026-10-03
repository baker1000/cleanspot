// Runs the DB test suites and the API suite against the real Supabase project configured in
// .env.supabase-cloud. Sequential on purpose: each DB test file holds one open transaction.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['supabase/tests/lite/**/*.test.ts', 'tests/remote-api/**/*.test.ts'],
    env: { DB_TARGET: 'remote' },
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
