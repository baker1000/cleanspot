#!/usr/bin/env node
// Sets up the `maintenance` Edge Function on the linked cloud project:
//   1. generates MAINTENANCE_SECRET into .env.supabase-cloud (if empty) — never printed
//   2. stores it as a function secret
//   3. deploys the function (server-side bundling, no Docker needed)
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = join(import.meta.dirname, '..', '.env.supabase-cloud');
process.loadEnvFile(ENV_FILE);

let secret = process.env.MAINTENANCE_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('hex');
  const content = readFileSync(ENV_FILE, 'utf8');
  const next = /^MAINTENANCE_SECRET=.*$/m.test(content)
    ? content.replace(/^MAINTENANCE_SECRET=.*$/m, `MAINTENANCE_SECRET=${secret}`)
    : `${content.trimEnd()}\nMAINTENANCE_SECRET=${secret}\n`;
  writeFileSync(ENV_FILE, next);
  console.log('Generated MAINTENANCE_SECRET in .env.supabase-cloud');
}

const ref = process.env.SUPABASE_PROJECT_REF;
const CLI = join(import.meta.dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');
// No shell, so the secret is passed verbatim and never echoed.
const run = (args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(['secrets', 'set', `MAINTENANCE_SECRET=${secret}`, '--project-ref', ref]);
run(['functions', 'deploy', 'maintenance', '--no-verify-jwt', '--use-api', '--project-ref', ref]);
console.log('maintenance function deployed.');
