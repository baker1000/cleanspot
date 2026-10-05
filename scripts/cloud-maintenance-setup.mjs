#!/usr/bin/env node
// Sets up the `maintenance` Edge Function on a cloud project (`--target verify` = default, or
// `--target demo`):
//   1. generates MAINTENANCE_SECRET into that project's env file (if empty) — never printed
//   2. stores it as a function secret
//   3. deploys the function (server-side bundling, no Docker needed)
//   4. stores URL + secret in Vault and schedules the hourly pg_cron job that calls the function
// Safe to re-run: secrets are updated in place and the cron job is replaced by name.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadCloudTarget } from './cloud-target.mjs';

const { file: ENV_FILE, fileName } = loadCloudTarget();

let secret = process.env.MAINTENANCE_SECRET;
if (!secret) {
  secret = randomBytes(32).toString('hex');
  const content = readFileSync(ENV_FILE, 'utf8');
  const next = /^MAINTENANCE_SECRET=.*$/m.test(content)
    ? content.replace(/^MAINTENANCE_SECRET=.*$/m, `MAINTENANCE_SECRET=${secret}`)
    : `${content.trimEnd()}\nMAINTENANCE_SECRET=${secret}\n`;
  writeFileSync(ENV_FILE, next);
  console.log(`Generated MAINTENANCE_SECRET in ${fileName}`);
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

// --- 4. Vault secrets + hourly schedule -------------------------------------------------------
const functionUrl = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/maintenance`;
const sql = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: process.env.SUPABASE_DB_CA_CERT
    ? { ca: readFileSync(process.env.SUPABASE_DB_CA_CERT, 'utf8') }
    : { rejectUnauthorized: false },
});
await sql.connect();
try {
  // Values go in as query parameters, so they never appear in SQL text or logs.
  const upsertSecret = async (name, value) => {
    const { rows } = await sql.query('select id from vault.secrets where name = $1', [name]);
    if (rows.length) await sql.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
    else await sql.query('select vault.create_secret($1, $2)', [value, name]);
  };
  await upsertSecret('maintenance_url', functionUrl);
  await upsertSecret('maintenance_secret', secret);

  await sql.query('create extension if not exists pg_net');
  // Keep in sync with supabase/functions/maintenance/README.md.
  await sql.query(
    `select cron.schedule('cleanspot-maintenance', '17 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-maintenance-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'maintenance_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$)`,
  );
  console.log('Vault secrets stored; cron job cleanspot-maintenance scheduled (17 * * * *).');
} finally {
  await sql.end();
}
